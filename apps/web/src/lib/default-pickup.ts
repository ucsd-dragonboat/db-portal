import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { defaultSpotColumns, savedSpotId } from "@/lib/campus-spots";
import { expireUser } from "@/lib/session-cache";

type Row = { ride: string; pickup_location_id: string | null; pickup_address: string | null; pickup_lat: number | null; pickup_lon: number | null };

/** The rider ticked "save as my default" (`${prefix}save_default`): an on-campus spot
 * (pickup location or saved location) becomes their default pickup spot; a typed
 * off-campus address overwrites their
 * profile's home address (with the coordinates just looked up) and clears the spot —
 * but only if it was found on the map, so a typo never wipes a working home location. */
export async function saveDefaultPickup(supabase: SupabaseClient<Database>, userId: string, fd: FormData, prefix: string, row: Row) {
  if (fd.get(`${prefix}save_default`) !== "on" || row.ride !== "needs_ride") return;
  const chosen = String(fd.get(`${prefix}pickup`) ?? "");
  if (row.pickup_location_id || savedSpotId(chosen))
    await supabase.from("profiles").update(defaultSpotColumns(row.pickup_location_id ?? chosen)).eq("id", userId);
  else if (row.pickup_address && row.pickup_lat != null && row.pickup_lon != null)
    await supabase.from("profiles").update({
      ...defaultSpotColumns(null), address: row.pickup_address, city: null, zipcode: null, lat: row.pickup_lat, lon: row.pickup_lon,
    }).eq("id", userId);
  else return;
  expireUser(userId);
}
