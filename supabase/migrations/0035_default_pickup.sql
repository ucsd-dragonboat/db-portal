-- A member's default ride pickup spot (an on-campus pickup location). Set from the
-- form's "save as my default" checkbox or the profile; preselected on future forms.
alter table public.profiles add column if not exists default_pickup_location_id uuid
  references public.pickup_locations(id) on delete set null;
