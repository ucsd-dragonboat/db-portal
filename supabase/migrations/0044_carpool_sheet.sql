-- Carpool → Google Sheets: one team spreadsheet; publishing a layout writes it a tab.

-- The team's carpool spreadsheet, written with the linking admin's Google connection
-- (user_google_tokens, 0022). Service-role only: RLS enabled with NO policies.
create table public.carpool_sheet_links (
  org_id         uuid primary key references public.organizations(id) on delete cascade,
  spreadsheet_id text not null,
  linked_by      uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.carpool_sheet_links enable row level security;

-- The layout's tab (gid) in that spreadsheet, so a re-publish rewrites the same tab.
alter table public.carpools
  add column sheet_spreadsheet_id text,
  add column sheet_tab_id         bigint;
