-- Google Sheets sync: per-admin OAuth tokens + per-form sheet link.

-- Google OAuth refresh tokens for Sheets sync. Service-role only:
-- RLS enabled with NO policies (same posture as user_calendar_tokens, 0020).
create table public.user_google_tokens (
  user_id                uuid primary key references public.profiles(id) on delete cascade,
  google_email           text not null,
  refresh_token          text not null,
  access_token           text,
  access_expires_at      timestamptz,
  default_spreadsheet_id text,
  created_at             timestamptz not null default now()
);
alter table public.user_google_tokens enable row level security;

-- Per-form link: each form writes to its own tab (gid) in the target spreadsheet.
alter table public.forms
  add column sheet_spreadsheet_id text,
  add column sheet_tab_id         bigint,
  add column sheet_linked_by      uuid references public.profiles(id) on delete set null;
