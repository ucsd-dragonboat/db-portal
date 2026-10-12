-- On-campus pickup spots now include the team's saved locations as well as its pickup
-- locations. A rider picking a saved location stores its name + coordinates on the
-- RSVP (pickup_address / pickup_lat / pickup_lon); these columns cover the rest.

-- A member's default spot when it's a saved location (default_pickup_location_id,
-- 0035, covers pickup locations; at most one of the two is set).
alter table public.profiles add column if not exists default_saved_location_id uuid
  references public.saved_locations(id) on delete set null;

-- Form creators can fix where on-campus riders are picked up: null = riders choose,
-- otherwise a pickup location id or 'saved:<saved location id>'.
alter table public.forms add column if not exists campus_pickup text;
