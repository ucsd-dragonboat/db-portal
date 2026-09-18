// Snapshots each car's real route distance/duration into carpool_trips when a
// carpool is published — the Statistics page's driving stats only ever read
// these rows, never call OSRM themselves (it's a rate-limited public server).
// Runs in the background via after() so publishing doesn't wait on routing.

import {
  buildOsrmRouteUrl,
  carRoutePoints,
  parseOsrmRoute,
  type CarpoolDataV2,
  type Destination,
  type LatLon,
  type Rider,
} from "@db/carpool";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, Rsvp } from "@/lib/database.types";
import { riderFromRsvp } from "@/lib/riders";

async function fetchRoute(points: LatLon[]): Promise<{ distanceKm: number; durationMin: number } | null> {
  if (points.length < 2) return null;
  try {
    const res = await fetch(buildOsrmRouteUrl(points), {
      headers: { "User-Agent": "db-portal-carpool" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const route = parseOsrmRoute(await res.json());
    return route ? { distanceKm: route.distanceKm, durationMin: route.durationMin } : null;
  } catch {
    return null; // fail-soft: a car just doesn't get a trip row this publish
  }
}

export async function recordCarpoolTrips(orgId: string, eventId: string, data: CarpoolDataV2): Promise<void> {
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!event || event.location_lat == null || event.location_lon == null) {
    await admin.from("carpool_trips").delete().eq("event_id", eventId);
    return;
  }
  const destination: Destination = { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title };

  const [{ data: rs }, { data: pickups }] = await Promise.all([
    admin.from("rsvps").select("*, profile:profiles(*)").eq("event_id", eventId),
    admin.from("pickup_locations").select("*").eq("org_id", orgId),
  ]);
  const pickupBy = new Map((pickups ?? []).map((p) => [p.id, p]));
  const riders: Record<string, Rider> = {};
  for (const r of (rs ?? []) as (Rsvp & { profile: Profile | null })[]) {
    const out = riderFromRsvp(r, pickupBy);
    if (out) riders[out.rider.id] = out.rider;
  }

  type Row = { org_id: string; event_id: string; direction: "going" | "back"; driver_id: string; passenger_ids: string[]; distance_km: number; duration_min: number };
  const rows: Row[] = [];
  let routed = 0, failed = 0;
  for (const [direction, dirSet] of [["going", data.going], ["back", data.back]] as const) {
    const mode = direction === "going" ? "pickup" : "dropoff";
    for (const car of [...dirSet.onCampus, ...dirSet.offCampus]) {
      if (!riders[car.driverId]) continue; // driver isn't a real, located rider (guest or missing address)
      const passengerIds = car.passengerIds.filter((id) => riders[id]); // drop write-in guests — no profile to attribute stats to
      if (passengerIds.length === 0) continue;
      const points = carRoutePoints({ ...car, passengerIds }, riders, destination, mode);
      const route = await fetchRoute(points);
      if (!route) { failed++; continue; }
      routed++;
      rows.push({ org_id: orgId, event_id: eventId, direction, driver_id: car.driverId, passenger_ids: passengerIds, distance_km: route.distanceKm, duration_min: route.durationMin });
    }
  }

  // If every car we tried to route failed, OSRM is down rather than the carpool
  // being empty — leave the stored trips alone. Replacing them would wipe this
  // event's mileage for good (nothing backfills it).
  if (failed > 0 && routed === 0) return;

  await admin.from("carpool_trips").delete().eq("event_id", eventId);
  if (rows.length) await admin.from("carpool_trips").insert(rows);
}
