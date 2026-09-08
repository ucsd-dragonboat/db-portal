-- Per-member secret for the personal iCal feed URL (/api/calendar/<token>).
-- Service-role only: RLS enabled with NO policies (same posture as rate_limits,
-- 0016) so tokens can never leak through the teammate-readable profiles embeds.
-- Tokens are generated lazily by the app the first time a member's profile
-- renders the feed card — no default, no backfill.

create table public.user_calendar_tokens (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
alter table public.user_calendar_tokens enable row level security;
