-- Drive-style folders for organizing events (event_groups) in the admin panel.
-- Deleting a folder keeps its events (folder_id just resets to null).

create table public.event_folders (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index on public.event_folders (org_id, name);

alter table public.event_groups
  add column folder_id uuid references public.event_folders(id) on delete set null;

alter table public.event_folders enable row level security;
create policy "event_folders member read" on public.event_folders
  for select using (public.is_org_member(org_id));
create policy "event_folders admin write" on public.event_folders
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
