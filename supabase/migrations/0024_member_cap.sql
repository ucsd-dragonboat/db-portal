-- Optional per-org member cap (Members page checkbox). null = no cap.
-- Enforced in join_organization: once the roster is at the cap, the join
-- code stops admitting new people (already-members and admin-added
-- pending members are unaffected).

alter table public.organizations
  add column member_cap int check (member_cap is null or member_cap >= 1);

create or replace function public.join_organization(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare oid uuid; att record; cap int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into join_attempts (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into att from join_attempts where user_id = auth.uid() for update;
  if att.window_start < now() - interval '1 hour' then
    update join_attempts set count = 0, window_start = now() where user_id = auth.uid();
    att.count := 0;
  end if;
  if att.count >= 20 then raise exception 'too many attempts — try again later'; end if;

  select id, member_cap into oid, cap from organizations where join_code = upper(trim(code));
  if oid is null then
    update join_attempts set count = count + 1 where user_id = auth.uid();
    raise exception 'invalid join code';
  end if;

  -- Re-joining is always fine; only NEW members count against the cap.
  if not exists (select 1 from memberships where org_id = oid and user_id = auth.uid()) then
    if cap is not null and (select count(*) from memberships where org_id = oid) >= cap then
      raise exception 'this team is full — ask an admin to raise the member cap';
    end if;
    insert into memberships (org_id, user_id, role) values (oid, auth.uid(), 'member');
  end if;
  return oid;
end $$;
