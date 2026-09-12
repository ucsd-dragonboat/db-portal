// Auto-generates a draft carpool for one event from its RSVPs — the server-side
// twin of the admin builder's Optimize button, upgraded with real drive times:
// one OSRM `table` request gives the time+distance matrix between every home,
// pickup point, and the destination, and `optimizeCarpool` local-searches for
// the cheapest assignment. Called by the /api/cron/carpools route after a
// form's due date passes.

import {
  buildOsrmTableUrl,
  locationKey,
  mirrorDirSet,
  optimizeCarpool,
  parseOsrmTable,
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

type AdminClient = ReturnType<typeof createAdminClient>;

export type GenerateResult =
  | { ok: true; cars: number; assigned: number; unassigned: number }
  | { skipped: string }
  | { error: string };

const EMPTY_MATRIX: CostMatrix = { index: new Map(), durationMin: [], distanceKm: [] };

async function fetchMatrix(points: LatLon[]): Promise<CostMatrix> {
  try {
    const res = await fetch(buildOsrmTableUrl(points), {
      headers: { "User-Agent": "db-portal-carpool" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return EMPTY_MATRIX;
    return parseOsrmTable(points, await res.json()) ?? EMPTY_MATRIX;
  } catch {
    return EMPTY_MATRIX; // optimizeCarpool falls back to haversine estimates
  }
}

export async function generateCarpoolForEvent(
  supabase: AdminClient,
  orgId: string,
  eventId: string,
): Promise<GenerateResult> {
  const [{ data: event }, { data: existing }] = await Promise.all([
    supabase.from("events").select("*").eq("id", eventId).maybeSingle(),
    supabase.from("carpools").select("id").eq("event_id", eventId).maybeSingle(),
  ]);
  if (!event) return { error: "event not found" };
  if (existing) return { skipped: "carpool already started by an admin" };
  if (event.location_lat == null || event.location_lon == null)
    return { skipped: "event has no location coordinates" };
  const destination = { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title };

  const [{ data: rs }, { data: pickups }] = await Promise.all([
    supabase.from("rsvps").select("*, profile:profiles(*)").eq("event_id", eventId).in("status", ["yes", "maybe"]),
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
  if (cars.length === 0) return { skipped: "no drivers RSVP'd" };

  const seen = new Set<string>();
  const points: LatLon[] = [];
  for (const r of Object.values(riders)) {
    if (!r.location) continue;
    const key = locationKey(r.location);
    if (!seen.has(key)) { seen.add(key); points.push(r.location); }
  }
  points.push({ lat: destination.lat, lon: destination.lon });

  const matrix = await fetchMatrix(points);
  const res = optimizeCarpool(cars, riders, destination, matrix);

  // v2 sheet: optimized cars into Going split by campus keyword; Back starts as a
  // mirror (the form asks per-day attendance, not per-direction) — admins diverge it.
  const going = { ...splitByCampus(res.cars.map((c) => ({ ...c, id: `g:${c.driverId}` })), matchText, DEFAULT_COLLEGE_KEYWORDS), diy: [] };
  const data: CarpoolDataV2 = {
    v: 2, header: DEFAULT_CARPOOL_HEADER, funFactQuestionId: null,
    collegeKeywords: [...DEFAULT_COLLEGE_KEYWORDS], guests: [], going, back: mirrorDirSet(going),
  };
  const { error } = await supabase.from("carpools").upsert(
    { org_id: orgId, event_id: eventId, data: data as unknown as Json, published: false },
    { onConflict: "event_id" },
  );
  if (error) return { error: error.message };
  return {
    ok: true,
    cars: res.cars.length,
    assigned: res.cars.reduce((n, c) => n + c.passengerIds.length, 0),
    unassigned: res.unassigned.length,
  };
}
