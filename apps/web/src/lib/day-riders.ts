// One day's carpool roster, assembled server-side with the same rules as the admin
// builder page (lib/riders.ts): every "yes" RSVP becomes a rider; drivers carry
// their car capacity; needs-ride riders are the ones to seat.

import type { MatchText, Rider } from "@db/carpool";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile, Rsvp } from "@/lib/database.types";
import { riderFromRsvp } from "@/lib/riders";

export type DayRiders = {
  riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[];
  needsRide: string[];
  matchText: MatchText;
};

export async function loadDayRiders(supabase: SupabaseClient<Database>, orgId: string, eventId: string): Promise<DayRiders> {
  const [{ data: rs }, { data: pickups }] = await Promise.all([
    supabase.from("rsvps").select("*, profile:profiles(*)").eq("event_id", eventId).eq("status", "yes"),
    supabase.from("pickup_locations").select("*").eq("org_id", orgId),
  ]);
  const pickupBy = new Map((pickups ?? []).map((p) => [p.id, p]));
  const out: DayRiders = { riders: {}, drivers: [], needsRide: [], matchText: {} };
  for (const r of (rs ?? []) as (Rsvp & { profile: Profile })[]) {
    const rr = riderFromRsvp(r, pickupBy);
    if (!rr) continue;
    out.riders[rr.rider.id] = rr.rider;
    const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
    out.matchText[rr.rider.id] = `${rr.rider.name} ${pk?.name ?? r.pickup_address ?? ""}`;
    if (rr.capacity != null) out.drivers.push({ id: rr.rider.id, seats: rr.capacity });
    if (r.ride === "needs_ride") out.needsRide.push(rr.rider.id);
  }
  return out;
}
