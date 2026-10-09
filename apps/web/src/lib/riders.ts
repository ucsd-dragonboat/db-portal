import type { Rider } from "@db/carpool";
import type { PickupLocation, Profile, Rsvp } from "@/lib/database.types";

/** The carpool rider-assembly rules, shared by the admin builder page and the
 * auto-carpool cron so they can never drift: a pickup point beats a ride-only
 * typed address (geocoded on save; null location when it couldn't be found),
 * which beats the home address; driver capacity = declared seats (or the profile
 * default) + the driver's own seat. The name is just the person's name — where
 * they're picked up / driving from travels separately (pickupNames / matchText)
 * and shows in the builder's Pickup notes, not glued onto the name. */
export function riderFromRsvp(
  r: Rsvp & { profile: Profile | null },
  pickupBy: Map<string, PickupLocation>,
): { rider: Rider; capacity: number | null } | null {
  const p = r.profile;
  if (!p) return null;
  const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
  const location = pk && pk.lat != null && pk.lon != null ? { lat: pk.lat, lon: pk.lon }
    : r.pickup_address ? (r.pickup_lat != null && r.pickup_lon != null ? { lat: r.pickup_lat, lon: r.pickup_lon } : null)
    : p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null;
  return {
    rider: { id: p.id, name: p.full_name || p.email, location },
    capacity: r.ride === "driver" ? (r.seats ?? (p.car_passengers || 3)) + 1 : null,
  };
}
