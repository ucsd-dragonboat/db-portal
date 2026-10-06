"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  layoutMembers, locationKey, movedRiders, optimizeCarpool, seatSnapshot, splitByCampus, upgradeCarpoolData,
  type CarpoolDataV2, type CostMatrix, type DirSet, type LatLon, type Rider,
} from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { recordCarpoolTrips } from "@/lib/carpool-trips";
import { driveMatrixWithSource, routeDrive } from "@/lib/routing";
import { loadDayRiders } from "@/lib/day-riders";
import { startRun, updateRun } from "@/lib/carpool-runs";
import type { Json } from "@/lib/database.types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function revalidateDay(supabase: Supabase, eventId: string) {
  const { data: ev } = await supabase.from("events").select("group_id").eq("id", eventId).maybeSingle();
  revalidatePath("/admin/carpool");
  revalidatePath(`/events/${eventId}`);
  if (ev?.group_id) revalidatePath(`/groups/${ev.group_id}`);
  revalidatePath("/statistics");
}

/** Save one layout. `carpoolId` null creates it. A rider can only be in one layout
 * per day, so the save is refused if this layout claims someone a sibling already has. */
export async function saveCarpool(carpoolId: string | null, eventId: string, name: string, data: CarpoolDataV2, published: boolean): Promise<{ ok: true; id: string } | { error: string }> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  // Normalize-as-validation: whatever the client sent becomes a well-formed v2 sheet.
  const clean = upgradeCarpoolData(data, {});
  const label = name.trim() || "Carpool";
  // Remember where everyone placed is right now, so a later address change shows up
  // in the builder as "moved since this was built".
  clean.seatedAt = { ...clean.seatedAt, ...seatSnapshot(clean, (await loadDayRiders(supabase, org.id, eventId)).riders) };

  const { data: siblings, error: sibErr } = await supabase.from("carpools").select("id, name, data, sort_order").eq("event_id", eventId).eq("org_id", org.id);
  if (sibErr) return { error: sibErr.message.includes("sort_order") ? "Run migration 0030_carpool_layouts.sql first" : sibErr.message };
  const mine = layoutMembers(clean);
  const clashes: { userId: string; layout: string }[] = [];
  for (const s of siblings ?? []) {
    if (s.id === carpoolId) continue;
    for (const id of layoutMembers(upgradeCarpoolData(s.data, {}))) if (mine.has(id)) clashes.push({ userId: id, layout: s.name });
  }
  if (clashes.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", clashes.map((c) => c.userId));
    const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
    return { error: `Already in another layout: ${clashes.map((c) => `${nameOf.get(c.userId) ?? "someone"} (“${c.layout}”)`).join(", ")}. Remove them there first.` };
  }

  let id = carpoolId;
  if (id) {
    const { error } = await supabase.from("carpools").update({ name: label, data: clean as unknown as Json, published }).eq("id", id).eq("org_id", org.id);
    if (error) return { error: error.message };
  } else {
    const sort_order = Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1;
    const { data: row, error } = await supabase.from("carpools")
      .insert({ org_id: org.id, event_id: eventId, name: label, sort_order, data: clean as unknown as Json, published }).select("id").single();
    if (error || !row) return { error: error?.message ?? "Couldn't create the layout." };
    id = row.id;
  }
  // Snapshot real route distances for the Statistics page — only on publish, since
  // it calls rate-limited routing servers (see lib/routing.ts).
  const savedId = id;
  if (published) after(() => recordCarpoolTrips(org.id, eventId, savedId, clean));
  await revalidateDay(supabase, eventId);
  return { ok: true, id: savedId };
}

/** "+ New layout" on a day: an empty, unpublished layout, opened straight away. */
export async function createCarpoolLayout(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const eventId = String(fd.get("event_id"));
  const { data: siblings } = await supabase.from("carpools").select("sort_order").eq("event_id", eventId).eq("org_id", org.id);
  const n = siblings?.length ?? 0;
  const { data: row, error } = await supabase.from("carpools").insert({
    org_id: org.id, event_id: eventId, name: n ? `Carpool ${n + 1}` : "Carpool",
    sort_order: Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1,
    data: upgradeCarpoolData({ v: 2 }, {}) as unknown as Json, published: false,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message.includes("sort_order") ? "Run migration 0030_carpool_layouts.sql first" : error?.message ?? "Couldn't create the layout.");
  await revalidateDay(supabase, eventId);
  redirect(`/admin/carpool?event=${eventId}&carpool=${row.id}`);
}

/** Delete one layout (its published mileage goes with it via the cascade). */
export async function deleteCarpoolLayout(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  const { data: row } = await supabase.from("carpools").select("event_id").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!row) return;
  await supabase.from("carpools").delete().eq("id", id).eq("org_id", org.id);
  await revalidateDay(supabase, row.event_id);
  redirect(`/admin/carpool?event=${row.event_id}`);
}

/** The builder map's route line for one car. Runs here rather than in the browser so
 * the routing fallbacks' API keys stay on the server. */
export async function routeCar(points: LatLon[]) {
  await requireAdmin();
  return routeDrive(points.slice(0, 50).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) })));
}

const EMPTY_MATRIX: CostMatrix = { index: new Map(), durationMin: [], distanceKm: [] };

export type OptimizeResult =
  | { ok: true; going: DirSet; seatedAt: Record<string, string>; provider: string | null; moved: string[]; unassigned: number; message: string }
  | { error: string };

/** The builder's Optimize: seats this layout's GOING riders using real drive times
 * from the routing fallback chain (the same optimizer the auto-carpool cron uses).
 * mode "unplaced" seats whoever still needs a ride and keeps every existing seat;
 * mode "moved" first unseats the riders whose pickup spot changed since the layout
 * was built, then seats just them again. Works on the builder's unsaved state and
 * returns the new GOING section — nothing is saved until the admin clicks Save. */
export async function optimizeLayout(carpoolId: string | null, eventId: string, data: CarpoolDataV2, mode: "unplaced" | "moved"): Promise<OptimizeResult> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).eq("org_id", org.id).maybeSingle();
  if (!event) return { error: "Day not found." };
  if (event.location_lat == null || event.location_lon == null) return { error: "This day has no location coordinates." };
  const destination = { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title };

  const clean = upgradeCarpoolData(data, {});
  const day = await loadDayRiders(supabase, org.id, eventId);
  // People another layout already has are off-limits here.
  const { data: siblings } = await supabase.from("carpools").select("id, data").eq("event_id", eventId).eq("org_id", org.id);
  const taken = new Set((siblings ?? []).filter((s) => s.id !== carpoolId).flatMap((s) => [...layoutMembers(upgradeCarpoolData(s.data, {}))]));

  const moved = mode === "moved" ? movedRiders(clean, day.riders) : [];
  const movedSet = new Set(moved);
  // Unseat moved passengers from unlocked cars; a driver who moved keeps their car.
  const cars = [...clean.going.onCampus, ...clean.going.offCampus].map((c) =>
    c.locked ? c : { ...c, passengerIds: c.passengerIds.filter((p) => !movedSet.has(p)) });
  const seated = new Set(cars.flatMap((c) => c.passengerIds));
  const pool: Record<string, Rider> = {};
  for (const c of cars) if (day.riders[c.driverId]) pool[c.driverId] = day.riders[c.driverId];
  for (const id of seated) if (day.riders[id]) pool[id] = day.riders[id];
  const toSeat = mode === "moved"
    ? moved.filter((id) => !cars.some((c) => c.driverId === id))
    : day.needsRide.filter((id) => !seated.has(id) && !clean.going.diy.includes(id) && !taken.has(id));
  for (const id of toSeat) if (day.riders[id]) pool[id] = day.riders[id];

  const seen = new Set<string>();
  const points: LatLon[] = [];
  for (const r of Object.values(pool)) {
    if (!r.location) continue;
    const k = locationKey(r.location);
    if (!seen.has(k)) { seen.add(k); points.push(r.location); }
  }
  points.push({ lat: destination.lat, lon: destination.lon });

  const runId = await startRun(supabase, { orgId: org.id, eventId, trigger: "manual" });
  const routed = await driveMatrixWithSource(points);
  const res = optimizeCarpool(cars, pool, destination, routed?.matrix ?? EMPTY_MATRIX);
  const going: DirSet = { ...splitByCampus(res.cars, day.matchText, clean.collegeKeywords), diy: clean.going.diy };
  const seatedAt = { ...clean.seatedAt, ...seatSnapshot({ ...clean, going }, day.riders) };
  const placed = toSeat.filter((id) => res.cars.some((c) => c.passengerIds.includes(id))).length;
  const message = `${mode === "moved" ? `Re-seated ${placed}/${toSeat.length} moved rider${toSeat.length === 1 ? "" : "s"}` : `Seated ${placed}/${toSeat.length} rider${toSeat.length === 1 ? "" : "s"}`}`
    + (res.unassigned.length ? ` · ${res.unassigned.length} couldn't be placed (no address or cars full)` : "")
    + (routed ? ` · drive times via ${routed.provider}` : " · routing unavailable, used straight-line estimates");
  await updateRun(supabase, runId, { status: "done", detail: message.split(" · ")[0], provider: routed?.provider ?? null, carpoolId });
  return { ok: true, going, seatedAt, provider: routed?.provider ?? null, moved, unassigned: res.unassigned.length, message };
}
