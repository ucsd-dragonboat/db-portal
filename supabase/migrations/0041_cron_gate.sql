-- Only call Vercel when the cron has work. The auto-carpools pg_cron job (0014) used
-- to call /api/cron/carpools every 10 minutes — 144 function calls a day, most of them
-- with nothing to do. Now the job asks cron_has_work() first, and Google Calendar's
-- pull (polling for edits made in Google) drops to hourly.

-- Mirrors app/api/cron/carpools/route.ts. p_now is only for testing.
create or replace function public.cron_has_work(p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- carpools: a form past its deadline not yet queued, a queued job, or a stuck one
    exists (select 1 from forms where status in ('open','closed') and due_at < p_now and carpools_generated_at is null)
    or exists (select 1 from carpool_runs where trigger = 'cron' and status = 'queued')
    or exists (select 1 from carpool_runs where status = 'running' and started_at < p_now - interval '5 minutes')
    -- "deadline in ~24h" reminders not yet sent
    or exists (select 1 from forms where status in ('open','closed') and due_at >= p_now and due_at < p_now + interval '24 hours' and deadline_reminder_sent_at is null)
    or exists (select 1 from events where rsvp_deadline >= p_now and rsvp_deadline < p_now + interval '24 hours' and deadline_reminder_sent_at is null)
    -- expired demo sandboxes to delete
    or exists (select 1 from organizations where is_demo and demo_expires_at < p_now)
    -- Google Calendar: hourly pull (the first tick of each hour), or a pull backlog
    -- that stopped at its time budget and saved a page token
    or exists (select 1 from google_calendar_sync where extract(minute from p_now) < 10 or sync_token like 'page:%')
    -- the daily image sweep
    or (extract(hour from p_now at time zone 'UTC') = 9 and extract(minute from p_now) < 10)
$$;
revoke execute on function public.cron_has_work(timestamptz) from public, anon, authenticated;

-- Gate the existing job in place, so its URL and secret never need to be in this file:
--   select net.http_post(...)  →  select net.http_post(...) where public.cron_has_work();
do $$
begin
  if to_regclass('cron.job') is null then return; end if; -- no pg_cron (local dev)
  perform cron.alter_job(jobid, command := regexp_replace(command, ';\s*$', '') || ' where public.cron_has_work();')
  from cron.job where jobname = 'auto-carpools' and command not like '%cron_has_work%';
end $$;

-- To undo (call Vercel every 10 minutes again):
--   select cron.alter_job(jobid, command := replace(command, ' where public.cron_has_work();', ';'))
--   from cron.job where jobname = 'auto-carpools';
