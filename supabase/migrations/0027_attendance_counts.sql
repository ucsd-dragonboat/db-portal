-- Per-person attendance counts for the Statistics page.
--
-- Replaces the old approach of fetching every event id in the org and passing
-- them all to `.in("event_id", ...)`: PostgREST puts that list in the request
-- URL, so a few hundred events would overflow the proxy's request-line limit
-- and fail the page outright — and it transferred one row per RSVP just to
-- count them in JavaScript.
--
-- Deliberately NOT security definer: RLS on rsvps/events already scopes reads
-- to the caller's own org, so the invoker's permissions are exactly right here.

create or replace function public.attendance_counts(org uuid)
returns table (user_id uuid, n bigint)
language sql stable as $$
  select r.user_id, count(*)::bigint
  from public.rsvps r
  join public.events e on e.id = r.event_id
  where e.org_id = org and r.status = 'yes'
  group by r.user_id;
$$;
