-- Statistics page: admins can correct each member's driving totals, the way
-- attendance_adjustment (0025) corrects attendance. The page shows computed + adjustment,
-- so totals keep counting new carpools after a correction.
alter table public.profiles
  add column if not exists drives_adjustment int not null default 0,
  add column if not exists miles_adjustment numeric not null default 0,
  add column if not exists minutes_adjustment numeric not null default 0;
