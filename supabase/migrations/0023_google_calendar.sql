-- Two-way Google Calendar sync: portal events mirror into a team calendar in the
-- connected admin's Google account; edits made in Google flow back via the cron.

alter table public.events
  add column google_event_id text,
  add column needs_info boolean not null default false; -- imported from Google, awaiting kind/group/details

-- One team calendar per org. Service-role only (RLS on, no policies).
create table public.google_calendar_sync (
  org_id      uuid primary key references public.organizations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  calendar_id text not null,
  sync_token  text,
  updated_at  timestamptz not null default now()
);
alter table public.google_calendar_sync enable row level security;
