-- carpool_runs becomes the auto-carpool queue. The cron used to build every day of a
-- form inside one 60 s call; a slow routing lookup could get the call killed halfway,
-- leaving the other days "queued" forever. Now each day is its own job: a tick claims
-- jobs one at a time until its time budget runs out, and the rest wait for the next tick.

alter table public.carpool_runs
  add column form_id uuid references public.forms(id) on delete set null,
  add column attempts int not null default 0;
create index carpool_runs_queued_idx on public.carpool_runs (started_at) where status = 'queued';

-- Takes the oldest queued cron job and marks it running. p_skip lists the jobs this
-- tick already handled, so one re-queued after an error waits for the next tick.
-- skip locked keeps overlapping ticks from taking the same job.
create or replace function public.claim_carpool_run(p_skip uuid[])
returns setof public.carpool_runs language sql security definer set search_path = public as $$
  update carpool_runs r set status = 'running', started_at = now(), attempts = r.attempts + 1
  where r.id = (select id from carpool_runs
                where status = 'queued' and trigger = 'cron' and not (id = any(p_skip))
                order by started_at limit 1 for update skip locked)
  returning r.*
$$;
revoke execute on function public.claim_carpool_run(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_carpool_run(uuid[]) to service_role;

-- A call lives at most 60 s, so a job "running" for 5 min was killed mid-build. Cron
-- jobs get re-queued (3 attempts in all); anything else is marked failed.
create or replace function public.recover_stale_carpool_runs()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update carpool_runs set
    status = case when trigger = 'cron' and attempts < 3 then 'queued' else 'error' end,
    detail = case when trigger = 'cron' and attempts < 3 then 'Timed out' else 'Didn''t finish (timed out)' end,
    finished_at = case when trigger = 'cron' and attempts < 3 then null else now() end,
    started_at = case when trigger = 'cron' and attempts < 3 then now() else started_at end
  where status = 'running' and started_at < now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.recover_stale_carpool_runs() from public, anon, authenticated;
grant execute on function public.recover_stale_carpool_runs() to service_role;
