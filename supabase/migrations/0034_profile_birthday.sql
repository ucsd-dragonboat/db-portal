-- Members' birthdays: required on the profile and on forms (when missing), and shown
-- on the team calendar (month and day only).
alter table public.profiles add column if not exists birthday date;
