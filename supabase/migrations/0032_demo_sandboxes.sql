-- Demo sandboxes: scan a QR code → your own throwaway copy of the portal.
--
-- A sandbox is an ordinary organization flagged is_demo, so it is isolated from real
-- teams by exactly the same org-scoped RLS that already separates teams. Each one is
-- seeded with fake members (@demo.invalid auth users that can never sign in), events,
-- a form with responses, a lineup and announcements, and expires after 24 hours.
-- Everything here is service-role only.

alter table public.organizations add column is_demo boolean not null default false;
alter table public.organizations add column demo_expires_at timestamptz;
create index organizations_demo_idx on public.organizations (demo_expires_at) where is_demo;

-- ------------------------------------------------------------------------------
-- create_demo_sandbox(visitor): builds one sandbox with `visitor` as its admin and
-- returns the new org id. Coordinates are pre-filled so seeding never geocodes.
-- ------------------------------------------------------------------------------
create or replace function public.create_demo_sandbox(visitor uuid)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  org uuid := gen_random_uuid();
  tag text := substr(replace(org::text, '-', ''), 1, 8);
  names text[] := array[
    'Ava Nguyen','Ben Carter','Chloe Park','Daniel Kim','Emma Rodriguez','Felix Chen','Grace Liu','Henry Patel',
    'Isabel Tran','Jack Morales','Kira Yamamoto','Leo Hernandez','Maya Singh','Noah Wong','Olivia Garcia','Peter Lee',
    'Quinn Shah','Rosa Martinez','Sam Huang','Tara Brooks','Umar Ali','Vivian Cho','Will Foster','Zoe Bennett'];
  genders text[] := array['female','male','female','male','female','male','female','male','female','male','female','male',
                          'female','male','female','male','other','female','male','female','male','female','male','female'];
  -- Homes around UCSD / La Jolla / Clairemont / Pacific Beach (name, lat, lon).
  streets text[] := array['3869 Miramar St','9500 Gilman Dr','8800 Villa La Jolla Dr','3550 Lebon Dr','4100 Nobel Dr',
    '7600 Regents Rd','3800 Governor Dr','4475 Bannock Ave','1700 Garnet Ave','4500 Mission Bay Dr','3950 Clairemont Dr',
    '8657 Villa La Jolla Dr','3985 Lamont St','4320 La Jolla Village Dr','5150 Balboa Ave','2850 Clairemont Dr',
    '9450 Gilman Dr','8920 Judicial Dr','3330 Governor Dr','1100 Grand Ave','3999 Mahaila Ave','4200 Eastgate Mall',
    '6200 Lake Murray Blvd','3700 Nobel Dr'];
  lats double precision[] := array[32.8729,32.8801,32.8667,32.8692,32.8713,32.8606,32.8540,32.8301,32.7979,32.8011,32.8250,
    32.8653,32.8016,32.8722,32.8228,32.8090,32.8812,32.8775,32.8563,32.7942,32.8705,32.8778,32.7820,32.8697];
  lons double precision[] := array[-117.2342,-117.2340,-117.2333,-117.2240,-117.2190,-117.2120,-117.2180,-117.1790,-117.2492,
    -117.2203,-117.2050,-117.2330,-117.2470,-117.2220,-117.1840,-117.2000,-117.2370,-117.2100,-117.2160,-117.2510,-117.2190,
    -117.2150,-117.0320,-117.2260];
  funfacts text[] := array['A moon jelly','A sea lion named Gary','Garibaldi, and I''d lose','A leopard shark (they''re chill)',
    'Two octopuses at once','A very small whale','Shamu''s cousin','A dragon (boat)','Any crab that looks at me funny',
    'A sea cucumber, gently','A grey whale, emotionally','A manta ray'];
  ids uuid[] := array[]::uuid[];
  uid uuid;
  i int;
  g_practice uuid := gen_random_uuid();
  g_race uuid := gen_random_uuid();
  sat uuid := gen_random_uuid();
  sun uuid := gen_random_uuid();
  race uuid := gen_random_uuid();
  f_practice uuid := gen_random_uuid();
  f_race uuid := gen_random_uuid();
  pk_peterson uuid := gen_random_uuid();
  pk_revelle uuid := gen_random_uuid();
  pk_sixth uuid := gen_random_uuid();
  sat_at timestamptz := date_trunc('week', now() + interval '7 days') + interval '5 days 15 hours';  -- next Sat 8am PT
  race_at timestamptz := date_trunc('week', now() + interval '14 days') + interval '5 days 14 hours';
  ride text; seats int; pickup uuid; paddr text; plat double precision; plon double precision; st text;
  seat_ids text[];
begin
  insert into organizations (id, name, join_code, created_by, is_demo, demo_expires_at)
  values (org, 'Demo Dragons', 'D' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7)), visitor, true, now() + interval '24 hours');
  update profiles set full_name = coalesce(nullif(full_name, ''), 'Demo Coach') where id = visitor;
  insert into memberships (org_id, user_id, role) values (org, visitor, 'admin');

  -- Fake teammates: auth users that can never sign in (no password, unroutable domain).
  for i in 1..24 loop
    uid := gen_random_uuid();
    ids := ids || uid;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      lower(replace(names[i], ' ', '.')) || '.' || tag || '@demo.invalid', '', now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', names[i]), now(), now(), '', '', '', '');
    update profiles set
      phone = '(858) 555-01' || lpad(i::text, 2, '0'),
      weight_lb = case when genders[i] = 'male' then 150 + (i * 7) % 45 else 120 + (i * 5) % 35 end,
      gender = genders[i],
      side_preference = (array['left','right','either'])[1 + i % 3],
      can_steer = i in (2, 9, 14), can_drum = i in (5, 21),
      address = streets[i], city = 'San Diego', zipcode = '921' || lpad(((i * 3) % 40 + 7)::text, 2, '0'),
      lat = lats[i], lon = lons[i], car_passengers = 3 + i % 2
    where id = uid;
    insert into memberships (org_id, user_id, role) values (org, uid, 'member');
  end loop;

  insert into pickup_locations (id, org_id, name, lat, lon, sort_order, active) values
    (pk_peterson, org, 'Peterson Loop', 32.8803, -117.2375, 0, true),
    (pk_revelle, org, 'Revelle College', 32.8743, -117.2416, 1, true),
    (pk_sixth, org, 'Sixth College', 32.8806, -117.2420, 2, true);
  insert into saved_locations (org_id, name, address, city, zipcode, lat, lon, sort_order) values
    (org, 'Mission Bay Aquatic Center', '1001 Santa Clara Pl', 'San Diego', '92109', 32.7783, -117.2470, 0),
    (org, 'Long Beach Marine Stadium', '5255 Paoli Way', 'Long Beach', '90803', 33.7667, -118.1270, 1);

  insert into event_groups (id, org_id, name, kind, created_by) values
    (g_practice, org, 'Week 3 Water Practice', 'practice', visitor),
    (g_race, org, 'Long Beach Dragon Boat Race', 'race', visitor);
  insert into events (id, org_id, kind, group_id, title, starts_at, ends_at, location_name, location_lat, location_lon, notes, created_by) values
    (sat, org, 'practice', g_practice, to_char(sat_at at time zone 'America/Los_Angeles', 'FMDay FMMM/FMDD'), sat_at, sat_at + interval '2 hours',
      'Mission Bay Aquatic Center', 32.7783, -117.2470, '<p>Bring water, sunscreen and a towel. We launch at 8:15 sharp.</p>', visitor),
    (sun, org, 'practice', g_practice, to_char((sat_at + interval '1 day') at time zone 'America/Los_Angeles', 'FMDay FMMM/FMDD'), sat_at + interval '1 day', sat_at + interval '1 day 2 hours',
      'Mission Bay Aquatic Center', 32.7783, -117.2470, '<p>Technique day — bring a friend who wants to try paddling!</p>', visitor),
    (race, org, 'race', g_race, to_char(race_at at time zone 'America/Los_Angeles', 'FMDay FMMM/FMDD'), race_at, race_at + interval '8 hours',
      'Long Beach Marine Stadium', 33.7667, -118.1270, '<p>Race day! Team shirts on. Heats start at 9.</p>', visitor);

  -- Practice form: open, due tomorrow, day questions + a fun fact.
  insert into forms (id, org_id, title, description, due_at, status, questions, ask_weight, created_by) values
    (f_practice, org, 'Week 3 Practice RSVP', '<p>Let us know if you''re coming and whether you can drive. Rides get built from this!</p>',
      now() + interval '1 day', 'open',
      jsonb_build_array(
        jsonb_build_object('id', 'day_' || sat, 'type', 'day', 'label', '', 'event_id', sat),
        jsonb_build_object('id', 'day_' || sun, 'type', 'day', 'label', '', 'event_id', sun),
        jsonb_build_object('id', 'fun', 'type', 'short_text', 'label', 'What''s the largest sea animal you could wrestle in Mission Bay?', 'required', false)),
      true, visitor),
    -- Race form: closed and just past due, so the auto-carpool cron picks it up within 10 minutes.
    (f_race, org, 'Long Beach Race Sign-up', '<p>Race day carpool sign-up. Closed — the carpool gets built automatically.</p>',
      now() - interval '5 minutes', 'closed',
      jsonb_build_array(jsonb_build_object('id', 'day_' || race, 'type', 'day', 'label', '', 'event_id', race)),
      false, visitor);
  insert into form_events (form_id, event_id, sort_order, prompt) values
    (f_practice, sat, 0, null), (f_practice, sun, 1, null), (f_race, race, 0, null);

  -- RSVPs + responses: a realistic mix of drivers, riders (some with a pickup spot or a
  -- ride-only address), people getting there themselves, maybes and nos.
  for i in 1..24 loop
    st := case when i in (23) then 'no' when i in (22) then 'maybe' else 'yes' end;
    ride := case when st <> 'yes' then 'none' when i % 4 = 1 then 'driver' when i % 4 in (2, 3) then 'needs_ride' else 'self' end;
    seats := case when ride = 'driver' then 3 + i % 2 else null end;
    pickup := case when ride = 'needs_ride' and i % 3 = 0 then pk_peterson when ride = 'needs_ride' and i % 5 = 0 then pk_revelle else null end;
    paddr := case when ride = 'needs_ride' and i in (7, 11) then 'Price Center, UCSD' else null end;
    plat := case when paddr is not null then 32.8797 else null end;
    plon := case when paddr is not null then -117.2362 else null end;
    if i <> 24 then  -- one person hasn't responded yet
      insert into rsvps (event_id, user_id, status, ride, seats, pickup_location_id, pickup_address, pickup_lat, pickup_lon, form_id)
      values (sat, ids[i], st, ride, seats, pickup, paddr, plat, plon, f_practice),
             (sun, ids[i], case when i % 6 = 0 then 'no' else st end, case when i % 6 = 0 then 'none' else ride end,
               case when i % 6 = 0 then null else seats end, case when i % 6 = 0 then null else pickup end,
               case when i % 6 = 0 then null else paddr end, case when i % 6 = 0 then null else plat end,
               case when i % 6 = 0 then null else plon end, f_practice);
      insert into form_responses (form_id, user_id, answers, submitted_at)
      values (f_practice, ids[i], case when i <= 12 then jsonb_build_object('fun', funfacts[i]) else '{}'::jsonb end,
              now() - make_interval(hours => 30 - i));
    end if;
    if i <= 16 then
      insert into rsvps (event_id, user_id, status, ride, seats, pickup_location_id, form_id)
      values (race, ids[i], 'yes', case when i % 3 = 1 then 'driver' else 'needs_ride' end,
              case when i % 3 = 1 then 4 else null end, case when i % 3 = 2 then pk_sixth else null end, f_race);
      insert into form_responses (form_id, user_id, answers, submitted_at) values (f_race, ids[i], '{}'::jsonb, now() - interval '2 days');
    end if;
  end loop;

  -- A published Saturday lineup (one boat): ids 1..20 in the seats, 5 drums, 2 steers.
  seat_ids := array(select ids[n]::text from generate_series(1, 22) n where n not in (2, 5));
  insert into lineups (org_id, event_id, name, boat_type, data, published, set_id, created_by) values
    (org, sat, 'Boat 1', 'mixed', jsonb_build_object(
      'boatType', 'mixed', 'drummer', ids[5]::text, 'steer', ids[2]::text,
      'seats', (select jsonb_agg(jsonb_build_array(seat_ids[r * 2 + 1], seat_ids[r * 2 + 2]) order by r) from generate_series(0, 9) r)),
      true, gen_random_uuid(), visitor);

  insert into announcements (org_id, author_id, title, body, pinned) values
    (org, visitor, 'Welcome to the demo! 👋', '<p>This is a sandbox with fake teammates — click around, edit anything, build a carpool, publish a lineup. It disappears in 24 hours.</p>', true),
    (org, visitor, 'Race shirts are in', '<p>Pick yours up at Saturday practice. Sizes S–XL.</p>', false);

  return org;
end $$;

revoke execute on function public.create_demo_sandbox(uuid) from public, anon, authenticated;
grant execute on function public.create_demo_sandbox(uuid) to service_role;

-- ------------------------------------------------------------------------------
-- cleanup_demo_sandboxes(): removes expired sandboxes and every @demo.invalid user
-- left without a team. Orgs go first (organizations.created_by blocks deleting its
-- creator); everything else cascades from the org or the user.
-- ------------------------------------------------------------------------------
create or replace function public.cleanup_demo_sandboxes(only_org uuid default null)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  with gone as (
    delete from organizations
    where is_demo and (id = only_org or (only_org is null and demo_expires_at < now()))
    returning id
  ) select count(*) into n from gone;
  delete from auth.users u
  where u.email like '%@demo.invalid'
    and not exists (select 1 from memberships m where m.user_id = u.id)
    and u.created_at < now() - interval '2 minutes';  -- don't race a sandbox being built
  return n;
end $$;

revoke execute on function public.cleanup_demo_sandboxes(uuid) from public, anon, authenticated;
grant execute on function public.cleanup_demo_sandboxes(uuid) to service_role;
