-- Several carpool layouts per day.
--
-- Until now a day had exactly one carpool (unique event_id). A day can now hold
-- any number of layouts, each covering different people (e.g. "Morning wave" and
-- "Afternoon wave"); the app keeps each rider in at most one layout per day. Most
-- days still have just one, named "Carpool".
--
-- carpool_trips gains carpool_id so publishing one layout replaces only that
-- layout's mileage snapshot instead of the whole day's.

alter table public.carpools drop constraint if exists carpools_event_id_key;
alter table public.carpools add column name text not null default 'Carpool';
alter table public.carpools add column sort_order int not null default 0;
alter table public.carpools add column created_at timestamptz not null default now();
create index if not exists carpools_event_sort_idx on public.carpools (event_id, sort_order, created_at);

alter table public.carpool_trips add column carpool_id uuid references public.carpools(id) on delete cascade;
-- One carpool per day until this migration, so event_id identifies it exactly.
update public.carpool_trips t set carpool_id = c.id from public.carpools c where c.event_id = t.event_id and t.carpool_id is null;
create index if not exists carpool_trips_carpool_idx on public.carpool_trips (carpool_id);
