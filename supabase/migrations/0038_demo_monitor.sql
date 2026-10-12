-- Demo monitor (admin "Demos" page). Sandboxes are deleted when they expire, so a
-- tiny log keeps the history: one row per sandbox, filled by triggers so every path
-- (QR start, Start over, cron cleanup, manual delete) is counted.

create table public.demo_log (
  org_id     uuid primary key,          -- no FK: the org is gone once the sandbox ends
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index demo_log_started_idx on public.demo_log (started_at);
alter table public.demo_log enable row level security;  -- no policies: service-role only

create or replace function public.demo_log_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into demo_log (org_id, started_at) values (new.id, new.created_at) on conflict do nothing;
  return new;
end $$;
create trigger demo_log_start after insert on public.organizations
  for each row when (new.is_demo) execute function public.demo_log_start();

create or replace function public.demo_log_end() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update demo_log set ended_at = now() where org_id = old.id;
  return old;
end $$;
create trigger demo_log_end after delete on public.organizations
  for each row when (old.is_demo) execute function public.demo_log_end();

-- Sandboxes already running when this migration runs.
insert into public.demo_log (org_id, started_at)
  select id, created_at from public.organizations where is_demo on conflict do nothing;

-- How long new sandboxes last (create_demo_sandbox still sets 24 h; the app then
-- applies this). 1 hour to 7 days.
alter table public.site_settings
  add column demo_hours int not null default 24 check (demo_hours between 1 and 168);

-- The log is a few bytes a row; keep a year.
select cron.schedule(
  'purge-demo-log',
  '45 9 * * *',
  $$ delete from public.demo_log where started_at < now() - interval '365 days' $$
);
