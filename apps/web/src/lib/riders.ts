import type { Rider } from "@db/carpool";
import type { PickupLocation, Profile, Rsvp } from "@/lib/database.types";

/** The carpool rider-assembly rules, shared by the admin builder page and the
 * auto-carpool cron so they can never drift: pickup point beats home address;
 * custom typed addresses aren't geocoded (location null); the " @ place" name
 * suffix only for needs_ride; driver capacity = declared seats (or the profile
 * default) + the driver's own seat. */
export function riderFromRsvp(
  r: Rsvp & { profile: Profile | null },
  pickupBy: Map<string, PickupLocation>,
): { rider: Rider; capacity: number | null } | null {
  const p = r.profile;
  if (!p) return null;
  const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
  const location = pk && pk.lat != null && pk.lon != null ? { lat: pk.lat, lon: pk.lon }
    : r.pickup_address ? null
    : p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null;
  const suffix = pk ? ` @ ${pk.name}` : r.pickup_address ? ` @ ${r.pickup_address}` : "";
  return {
    rider: { id: p.id, name: (p.full_name || p.email) + (r.ride === "needs_ride" ? suffix : ""), location },
    capacity: r.ride === "driver" ? (r.seats ?? (p.car_passengers || 3)) + 1 : null,
  };
}
