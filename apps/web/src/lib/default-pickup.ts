import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Row = { ride: string; pickup_location_id: string | null; pickup_address: string | null; pickup_lat: number | null; pickup_lon: number | null };

/** The rider ticked "save as my default" (`${prefix}save_default`): an on-campus spot
 * becomes their default pickup spot; a typed off-campus address overwrites their
 * profile's home address (with the coordinates just looked up) and clears the spot —
 * but only if it was found on the map, so a typo never wipes a working home location. */
export async function saveDefaultPickup(supabase: SupabaseClient<Database>, userId: string, fd: FormData, prefix: string, row: Row) {
  if (fd.get(`${prefix}save_default`) !== "on" || row.ride !== "needs_ride") return;
  if (row.pickup_location_id)
    await supabase.from("profiles").update({ default_pickup_location_id: row.pickup_location_id }).eq("id", userId);
  else if (row.pickup_address && row.pickup_lat != null && row.pickup_lon != null)
    await supabase.from("profiles").update({
      default_pickup_location_id: null, address: row.pickup_address, city: null, zipcode: null, lat: row.pickup_lat, lon: row.pickup_lon,
    }).eq("id", userId);
}
