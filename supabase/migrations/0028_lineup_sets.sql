-- Lineups are built first and filed to an event's days later.
--
-- A "set" is everything one builder session produces: every boat, across every
-- day it was filed to. One lineups row is still one boat on one day, so a 2-day
-- practice with 3 boats is 6 rows — set_id is what ties them back together so
-- the builder can reopen the whole thing and the list can show it as one entry.
--
-- event_id stays nullable and keeps its existing meaning: null = not filed to a
-- day yet (what the old "blank lineup" mode used).

alter table public.lineups add column set_id uuid;
create index on public.lineups (org_id, set_id);

-- Backfill so existing lineups still open: each day's rows become one set, and
-- the unfiled ones are each their own.
update public.lineups l
   set set_id = s.sid
  from (select event_id, gen_random_uuid() as sid
          from public.lineups
         where event_id is not null
         group by event_id) s
 where l.event_id = s.event_id and l.set_id is null;

update public.lineups set set_id = gen_random_uuid() where set_id is null;
