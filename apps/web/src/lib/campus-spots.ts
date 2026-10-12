import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/lib/database.types";

/** An on-campus pickup choice. `id` is a pickup location id, or `saved:<id>` for one
 * of the team's saved locations (migration 0037). */
export type CampusSpot = { id: string; name: string };
export const SAVED_SPOT = "saved:";
export const savedSpotId = (v: string | null | undefined) => (v?.startsWith(SAVED_SPOT) ? v.slice(SAVED_SPOT.length) : null);

/** The team's active pickup locations, then its saved locations that have coordinates
 * (skipping any whose name repeats a pickup location). */
export async function loadCampusSpots(supabase: SupabaseClient<Database>, orgId: string): Promise<CampusSpot[]> {
  const [{ data: pickups }, { data: saved }] = await Promise.all([
    supabase.from("pickup_locations").select("id, name").eq("org_id", orgId).eq("active", true).order("sort_order"),
    supabase.from("saved_locations").select("id, name").eq("org_id", orgId).not("lat", "is", null).not("lon", "is", null).order("sort_order").order("name"),
  ]);
  const taken = new Set((pickups ?? []).map((p) => p.name.trim().toLowerCase()));
  return [
    ...(pickups ?? []),
    ...(saved ?? []).filter((s) => !taken.has(s.name.trim().toLowerCase())).map((s) => ({ id: SAVED_SPOT + s.id, name: s.name })),
  ];
}

/** The member's saved default spot as a CampusSpot id, or null. */
export const profileDefaultSpot = (p: Pick<Profile, "default_pickup_location_id" | "default_saved_location_id">) =>
  p.default_pickup_location_id ?? (p.default_saved_location_id ? SAVED_SPOT + p.default_saved_location_id : null);

/** Profile columns for a chosen default spot ("" / null clears both). */
export const defaultSpotColumns = (v: string | null) => ({
  default_pickup_location_id: v && !savedSpotId(v) ? v : null,
  default_saved_location_id: savedSpotId(v),
});
