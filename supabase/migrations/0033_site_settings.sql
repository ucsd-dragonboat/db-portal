-- Site-wide switches (one row). Starts with the demo on/off toggle shown in Team
-- settings. Read and written only via the service role from server code.

create table public.site_settings (
  id           boolean primary key default true check (id),
  demo_enabled boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table public.site_settings enable row level security;  -- no policies: service-role only
insert into public.site_settings (id) values (true);
