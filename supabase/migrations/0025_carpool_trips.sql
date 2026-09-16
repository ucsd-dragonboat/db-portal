-- Statistics page: a snapshot of each car's real route distance/duration, taken
-- once when a carpool is published (OSRM is rate-limited, so we never re-query it
-- on read — the Statistics page just aggregates these rows). Replaced wholesale
-- for an event each time that carpool is re-published.

create table public.carpool_trips (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  direction     text not null check (direction in ('going','back')),
  driver_id     uuid not null references public.profiles(id) on delete cascade,
  passenger_ids uuid[] not null default '{}',
  distance_km   numeric not null,
  duration_min  numeric not null,
  created_at    timestamptz not null default now()
);
create index on public.carpool_trips (org_id);
create index on public.carpool_trips (driver_id);
create index carpool_trips_passengers_gin on public.carpool_trips using gin (passenger_ids);

alter table public.carpool_trips enable row level security;
create policy "carpool_trips admin all" on public.carpool_trips
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "carpool_trips member read" on public.carpool_trips
  for select using (public.is_org_member(org_id));

-- Manual delta on top of the RSVP-derived attendance count (same pattern as
-- profiles.car_passengers: a plain admin-editable number, no audit trail).
alter table public.profiles add column attendance_adjustment int not null default 0;
