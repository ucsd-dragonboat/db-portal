-- Drive-style folder upgrades: folders can nest inside folders, and each
-- folder can have a color. Deleting a parent lifts its children to the root.

alter table public.event_folders
  add column parent_id uuid references public.event_folders(id) on delete set null,
  add column color text;
