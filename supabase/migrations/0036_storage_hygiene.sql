-- Storage hygiene: index fixes, a daily purge of logs that only grow, and per-team
-- image folders (an admin of any team, demo sandboxes included, could upload or
-- delete any image).

-- ---------- indexes ----------
-- Nothing filters trips by driver or passenger (statistics loads them by org), and
-- every carpool save deletes and reinserts its trips, so these only cost writes.
drop index if exists public.carpool_trips_passengers_gin;
drop index if exists public.carpool_trips_driver_id_idx;
-- Queried by event alone (calendar, carpool queue, group and event pages), or needed
-- so deleting a member (demo cleanup deletes ~25 at a time) doesn't scan the table.
create index if not exists form_events_event_id_idx    on public.form_events (event_id);
create index if not exists lineups_event_id_idx        on public.lineups (event_id);
create index if not exists rsvps_user_id_idx           on public.rsvps (user_id);
create index if not exists form_responses_user_id_idx  on public.form_responses (user_id);

-- ---------- daily purge ----------
-- pg_cron logs every run (the carpool job runs every 10 minutes) and never deletes
-- them; the run-status UI only reads each day's newest carpool run.
select cron.schedule(
  'purge-logs',
  '30 9 * * *',
  $$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from public.carpool_runs where started_at < now() - interval '30 days';
  $$
);

-- ---------- images: one folder per team ----------
-- 0015 let an admin of ANY team upload or delete ANY image — and every demo visitor
-- is an admin of their sandbox. New uploads go to <org_id>/<file>, and only that
-- team's admins may write or delete there. Files uploaded before this (at the bucket
-- root) stay readable; only admins of a real (non-demo) team may delete them.
-- Public read is unchanged.
drop policy if exists "images auth upload" on storage.objects;
drop policy if exists "images auth delete" on storage.objects;
drop policy if exists "images admin upload" on storage.objects;
drop policy if exists "images admin delete" on storage.objects;

create or replace function public.image_folder_org(object_name text)
returns uuid language plpgsql immutable as $$
declare first text := (storage.foldername(object_name))[1];
begin
  return first::uuid;
exception when others then
  return null;  -- root-level file, or a folder name that isn't an org id
end $$;

create policy "images team upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and public.is_org_admin(public.image_folder_org(name)));

create policy "images team delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and (
    public.is_org_admin(public.image_folder_org(name))
    or (public.image_folder_org(name) is null and exists (
      select 1 from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and m.role = 'admin' and not o.is_demo))
  ));
