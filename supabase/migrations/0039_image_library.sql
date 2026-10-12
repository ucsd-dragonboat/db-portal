-- Admin Images panel + unused-image cleanup. An image is "used" when its storage path
-- appears in the team's rich-text fields — the only places the editor puts images:
-- announcements.body, events.notes, forms.description/questions, form_responses.answers.
-- File deletes and moves go through the Storage API (a SQL delete leaves the file).

-- Where p_org's content shows the image p_name (a few hits per kind). Internal helper.
create or replace function public.image_refs(p_org uuid, p_name text)
returns jsonb language sql stable set search_path = public as $$
  with hits as (
    (select 'announcement' as kind, a.id, a.title, null::uuid as form_id from announcements a
      where a.org_id = p_org and strpos(a.body, '/images/' || p_name) > 0 limit 5)
    union all
    (select 'event', e.id, e.title, null from events e
      where e.org_id = p_org and strpos(coalesce(e.notes, ''), '/images/' || p_name) > 0 limit 5)
    union all
    (select 'form', f.id, f.title, f.id from forms f
      where f.org_id = p_org and (strpos(f.description, '/images/' || p_name) > 0 or strpos(f.questions::text, '/images/' || p_name) > 0) limit 5)
    union all
    (select 'response', r.user_id, f.title, f.id from form_responses r join forms f on f.id = r.form_id
      where f.org_id = p_org and strpos(r.answers::text, '/images/' || p_name) > 0 limit 5)
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title', title, 'form_id', form_id)), '[]'::jsonb) from hits
$$;
revoke execute on function public.image_refs(uuid, text) from public, anon, authenticated;

-- The Images panel: the team's folder, plus (real teams only) files from before team
-- folders at the bucket root. Admins of p_org only; anyone else gets no rows.
create or replace function public.team_images(p_org uuid)
returns table (name text, size bigint, mime text, created_at timestamptz, uploader text, legacy boolean, refs jsonb)
language sql stable security definer set search_path = public, storage as $$
  select o.name, coalesce((o.metadata->>'size')::bigint, 0), o.metadata->>'mimetype', o.created_at,
         p.full_name, strpos(o.name, '/') = 0, public.image_refs(p_org, o.name)
  from storage.objects o
  left join public.profiles p on p.id = o.owner
  where o.bucket_id = 'images'
    and public.is_org_admin(p_org)
    and o.name not like '%.emptyFolderPlaceholder'
    and (o.name like p_org::text || '/%'
         or (strpos(o.name, '/') = 0 and not (select is_demo from public.organizations where id = p_org)))
  order by o.created_at desc
$$;
revoke execute on function public.team_images(uuid) from public, anon;
grant execute on function public.team_images(uuid) to authenticated;

-- Nightly sweep: team-folder files older than min_age that nothing of that team uses
-- (a deleted team's leftovers included). Root-level files are never swept.
create or replace function public.orphan_images(min_age interval)
returns setof text language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
  where o.bucket_id = 'images'
    and public.image_folder_org(o.name) is not null
    and o.name not like '%.emptyFolderPlaceholder'
    and o.created_at < now() - min_age
    and public.image_refs(public.image_folder_org(o.name), o.name) = '[]'::jsonb
$$;
revoke execute on function public.orphan_images(interval) from public, anon, authenticated;
grant execute on function public.orphan_images(interval) to service_role;

-- Root-level files p_org may adopt: ones no other team's content uses.
create or replace function public.legacy_images_for(p_org uuid)
returns setof text language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
  where o.bucket_id = 'images' and strpos(o.name, '/') = 0 and o.name not like '.%'
    and not exists (select 1 from public.organizations g
                    where g.id <> p_org and public.image_refs(g.id, o.name) <> '[]'::jsonb)
$$;
revoke execute on function public.legacy_images_for(uuid) from public, anon, authenticated;
grant execute on function public.legacy_images_for(uuid) to service_role;

-- After a file is copied to a new path, point p_org's content at it. Returns rows changed.
create or replace function public.rewrite_image_path(p_org uuid, old_name text, new_name text)
returns int language plpgsql security definer set search_path = public as $$
declare o text := '/images/' || old_name; n text := '/images/' || new_name; c int := 0; k int;
begin
  update announcements set body = replace(body, o, n) where org_id = p_org and strpos(body, o) > 0;
  get diagnostics k = row_count; c := c + k;
  update events set notes = replace(notes, o, n) where org_id = p_org and strpos(notes, o) > 0;
  get diagnostics k = row_count; c := c + k;
  update forms set description = replace(description, o, n), questions = replace(questions::text, o, n)::jsonb
    where org_id = p_org and (strpos(description, o) > 0 or strpos(questions::text, o) > 0);
  get diagnostics k = row_count; c := c + k;
  update form_responses r set answers = replace(r.answers::text, o, n)::jsonb
    from forms f where f.id = r.form_id and f.org_id = p_org and strpos(r.answers::text, o) > 0;
  get diagnostics k = row_count; c := c + k;
  return c;
end $$;
revoke execute on function public.rewrite_image_path(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rewrite_image_path(uuid, text, text) to service_role;
