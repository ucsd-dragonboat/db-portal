-- Ride-only addresses that reach the carpool map.
--
-- rsvps.pickup_address already holds a typed, one-off address for a day ("Other…"
-- for riders, and now "starting somewhere else" for drivers), but nothing ever
-- turned it into coordinates, so the carpool tools had no location for that person.
-- The app now geocodes the text on save and keeps the result here. Null when the
-- address is blank or couldn't be found (the coach still sees the text).

alter table public.rsvps add column pickup_lat double precision;
alter table public.rsvps add column pickup_lon double precision;
