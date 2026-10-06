-- One row per run of the carpool algorithm — the auto-carpool cron and an admin's
-- Optimize click — so admins can see that it's queued/running and how it ended
-- (which routing provider answered, how many seated, or why it was skipped).
-- Admin-only: members never see these.

create table public.carpool_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  carpool_id uuid references public.carpools(id) on delete set null,
  trigger text not null check (trigger in ('cron', 'manual')),
  status text not null check (status in ('queued', 'running', 'done', 'skipped', 'error')),
  detail text,
  provider text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index carpool_runs_event_idx on public.carpool_runs (event_id, started_at desc);

alter table public.carpool_runs enable row level security;
create policy "carpool_runs admin all" on public.carpool_runs
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
