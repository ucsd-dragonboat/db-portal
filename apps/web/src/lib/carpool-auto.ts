// Auto-generates a draft carpool for one event from its RSVPs — the server-side
// twin of the admin builder's Optimize button, upgraded with real drive times:
// one routing `table` request (lib/routing.ts) gives the time+distance matrix between every home,
// pickup point, and the destination, and `optimizeCarpool` local-searches for
// the cheapest assignment. Called by the /api/cron/carpools route after a
// form's due date passes.

import {
  locationKey,
  mirrorDirSet,
  optimizeCarpool,
  seatSnapshot,
  splitByCampus,
  DEFAULT_CARPOOL_HEADER,
  DEFAULT_COLLEGE_KEYWORDS,
  type Car,
  type CarpoolDataV2,
  type CostMatrix,
  type LatLon,
  type MatchText,
  type Rider,
} from "@db/carpool";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Profile, Rsvp } from "@/lib/database.types";
import { riderFromRsvp } from "@/lib/riders";
import { driveMatrixWithSource } from "@/lib/routing";
import { updateRun } from "@/lib/carpool-runs";

type AdminClient = ReturnType<typeof createAdminClient>;

export type GenerateResult =
  | { ok: true; cars: number; assigned: number; unassigned: number }
  | { skipped: string }
  | { error: string };

const EMPTY_MATRIX: CostMatrix = { index: new Map(), durationMin: [], distanceKm: [] };

/** Generates one day's draft carpool and, when given a carpool_runs row, keeps it
 * up to date (running → done / skipped / error) so admins can watch it happen. */
export async function generateCarpoolForEvent(
  supabase: AdminClient,
  orgId: string,
  eventId: string,
  runId: string | null = null,
): Promise<GenerateResult> {
  await updateRun(supabase, runId, { status: "running" });
  let out: Built;
  try { out = await build(supabase, orgId, eventId); }
  catch (e) { out = { result: { error: e instanceof Error ? e.message : String(e) } }; }
  const r = out.result;
  await updateRun(supabase, runId, "ok" in r
    ? { status: "done", detail: `${r.cars} car${r.cars === 1 ? "" : "s"}, ${r.assigned} seated${r.unassigned ? `, ${r.unassigned} unplaced` : ""}`, provider: out.provider ?? null, carpoolId: out.carpoolId ?? null }
    : "skipped" in r ? { status: "skipped", detail: r.skipped } : { status: "error", detail: r.error });
  return r;
}

type Built = { result: GenerateResult; provider?: string | null; carpoolId?: string };

async function build(supabase: AdminClient, orgId: string, eventId: string): Promise<Built> {
  const [{ data: event }, { data: existing }] = await Promise.all([
    supabase.from("events").select("*").eq("id", eventId).maybeSingle(),
    supabase.from("carpools").select("id").eq("event_id", eventId).limit(1).maybeSingle(),
  ]);
  if (!event) return { result: { error: "event not found" } };
  if (existing) return { result: { skipped: "carpool already started by an admin" } };
  if (event.location_lat == null || event.location_lon == null)
    return { result: { skipped: "event has no location coordinates" } };
  const destination = { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title };

  const [{ data: rs }, { data: pickups }] = await Promise.all([
    // Yes only — a Maybe isn't attending until they change it (see lib/attendees.ts).
    supabase.from("rsvps").select("*, profile:profiles(*)").eq("event_id", eventId).eq("status", "yes"),
    supabase.from("pickup_locations").select("*").eq("org_id", orgId),
  ]);
  const pickupBy = new Map((pickups ?? []).map((p) => [p.id, p]));

  // Same rider-assembly rules as the admin builder (lib/riders.ts). Only drivers
  // and needs_ride riders matter here.
  const riders: Record<string, Rider> = {};
  const cars: Car[] = [];
  const matchText: MatchText = {};
  for (const r of (rs ?? []) as (Rsvp & { profile: Profile })[]) {
    if (r.ride !== "driver" && r.ride !== "needs_ride") continue;
    const out = riderFromRsvp(r, pickupBy);
    if (!out) continue;
    riders[out.rider.id] = out.rider;
    const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
    matchText[out.rider.id] = `${out.rider.name} ${pk?.name ?? r.pickup_address ?? ""}`;
    if (out.capacity != null)
      cars.push({ id: out.rider.id, driverId: out.rider.id, capacity: out.capacity, passengerIds: [] });
  }
  if (cars.length === 0) return { result: { skipped: "no drivers RSVP'd" } };

  const seen = new Set<string>();
  const points: LatLon[] = [];
  for (const r of Object.values(riders)) {
    if (!r.location) continue;
    const key = locationKey(r.location);
    if (!seen.has(key)) { seen.add(key); points.push(r.location); }
  }
  points.push({ lat: destination.lat, lon: destination.lon });

  const routed = await driveMatrixWithSource(points, orgId); // null: optimizeCarpool falls back to haversine
  const res = optimizeCarpool(cars, riders, destination, routed?.matrix ?? EMPTY_MATRIX);

  // v2 sheet: optimized cars into Going split by campus keyword; Back starts as a
  // mirror (the form asks per-day attendance, not per-direction) — admins diverge it.
  const going = { ...splitByCampus(res.cars.map((c) => ({ ...c, id: `g:${c.driverId}` })), matchText, DEFAULT_COLLEGE_KEYWORDS), diy: [] };
  const data: CarpoolDataV2 = {
    v: 2, header: DEFAULT_CARPOOL_HEADER, funFactQuestionId: null,
    collegeKeywords: [...DEFAULT_COLLEGE_KEYWORDS], guests: [], going, back: mirrorDirSet(going),
  };
  data.seatedAt = seatSnapshot(data, riders); // so later address changes can be spotted
  // The day's first (and default) layout.
  const { data: row, error } = await supabase.from("carpools").insert({ org_id: orgId, event_id: eventId, name: "Carpool", data: data as unknown as Json, published: false }).select("id").single();
  if (error || !row) return { result: { error: error?.message ?? "insert failed" } };
  return {
    result: {
      ok: true,
      cars: res.cars.length,
      assigned: res.cars.reduce((n, c) => n + c.passengerIds.length, 0),
      unassigned: res.unassigned.length,
    },
    provider: routed?.provider ?? null,
    carpoolId: row.id,
  };
}
