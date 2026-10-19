-- File upload questions on forms. Files are private: there are no storage policies for
-- signed-in or anonymous users, so the only ways in are the app's service-role calls —
-- a signed upload URL handed out after checking the form (lib/form-files.ts), and a
-- short-lived signed download URL for the team's admins or the uploader
-- (app/api/form-file). Paths: <org_id>/<form_id>/<uuid>/<file name>.
-- 50 MB is the largest single file Supabase's free plan accepts; each question sets its own lower limit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('form-files', 'form-files', false, 52428800)
on conflict (id) do nothing;

-- What was really uploaded (size and type as stored), for checking a response before saving it.
create or replace function public.form_file_meta(p_paths text[])
returns table (name text, size bigint, mime text)
language sql stable security definer set search_path = public, storage as $$
  select o.name, coalesce((o.metadata->>'size')::bigint, 0), o.metadata->>'mimetype'
  from storage.objects o
  where o.bucket_id = 'form-files' and o.name = any(p_paths)
$$;
revoke execute on function public.form_file_meta(text[]) from public, anon, authenticated;
grant execute on function public.form_file_meta(text[]) to service_role;

-- Bytes a team has stored in form uploads (each team gets a cap).
create or replace function public.form_files_bytes(p_org uuid)
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'form-files' and o.name like p_org::text || '/%'
$$;
revoke execute on function public.form_files_bytes(uuid) from public, anon, authenticated;
grant execute on function public.form_files_bytes(uuid) to service_role;

-- Nightly sweep: uploads older than min_age that no response to their form points at —
-- picked but never submitted, removed from an answer, or the response/form/team was
-- deleted. Removal goes through the Storage API (a SQL delete would leave the file).
create or replace function public.orphan_form_files(min_age interval)
returns setof text language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
  where o.bucket_id = 'form-files'
    and o.created_at < now() - min_age
    and not exists (
      select 1 from public.form_responses r
      where r.form_id::text = (storage.foldername(o.name))[2]
        and strpos(r.answers::text, o.name) > 0)
$$;
revoke execute on function public.orphan_form_files(interval) from public, anon, authenticated;
grant execute on function public.orphan_form_files(interval) to service_role;
