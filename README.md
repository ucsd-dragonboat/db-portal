# Dragon Boat Team Portal

Team portal for a ~50-person dragon boat team: announcements board, weekly
practice / race / social **forms** (attendance + rides + custom questions),
boat lineup builder, and carpool coordination. Admin panel +
member panel, multi-team ("organization") aware. Everything runs on free tiers.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, TS, Tailwind) in `apps/web` | Vercel-native, server actions, no separate API |
| DB / Auth | Supabase (Postgres + Auth + RLS) | Free tier, row-level multi-tenancy |
| Hosting | Vercel Hobby | Free |
| Maps | MapLibre GL + OpenFreeMap tiles | Free, no key |
| Geocoding | Nominatim (OSM) | Free (1 req/s; addresses geocoded once, on save) |
| Routing | Public OSRM demo server | Free (fair use; ~1 request per car per optimize) |
| Algorithms | `packages/lineup`, `packages/carpool` | Pure TS ports of Db_Lineup_Maker + carpool-optimizer, unit-tested |

```
apps/web/            Next.js app (admin + member panels)
packages/lineup/     @db/lineup  — lineup model, auto-fill, mastersheet export
packages/carpool/    @db/carpool — assignment, stop ordering, OSRM/Nominatim URL builders
supabase/migrations/ SQL schema + RLS policies + RPCs
```

## Data model (supabase/migrations/0001_init.sql)

- `profiles` — 1:1 with auth users; weight/gender/side pref/steer/drum + address (geocoded lat/lon), can_drive, car_seats
- `organizations` (team) with a `join_code`; `memberships (org_id, user_id, role: admin|member)`
- `announcements` (admin → board)
- `event_groups` — wrapper for several day-events (e.g. "Spring Week 8 Practice" = Sat + Sun); `/groups/[id]` shows every day's attendance, lineups and rides on one screen
- `events` (`kind`: practice | race | social | other, `group_id`, time, location lat/lon)
- `pickup_locations` — named meetup spots (e.g. each campus college) paddlers can choose when they need a ride
- `forms` — the weekly practice form / race logistics form: description, due date, `status` draft|open|closed,
  `questions` jsonb (short/long text, single/multi choice, yes/no, number); `form_events` links a form to
  1..n events (each gets the standard attendance question); `form_responses` (one per user, latest wins)
- `rsvps (event_id, user_id)` — normalized attendance: `status yes/maybe/no`, `ride driver|self|needs_ride|none`,
  `seats`, `pickup_location_id` / `pickup_address`, `form_id`. Written by both forms and the quick RSVP, and read
  by the lineup and carpool builders.
- `lineups` (jsonb `@db/lineup` Lineup, `published` flag) and `carpools` (jsonb cars, `published`)
- RLS: members read within their org; admins write; profiles readable by teammates; users write own profile/RSVP/
  form response (only while the form is open); lineups/carpools visible to members only when published; draft forms hidden.
- RPCs: `create_organization(name)` (caller becomes admin), `join_organization(code)`.

## Local setup

1. Create a free Supabase project → SQL editor → run `supabase/migrations/0001_init.sql`.
   (Or `supabase link` + `supabase db push` if you install the CLI.)
2. Auth → Providers → Email must be enabled. Sign-in is email-only (no passwords, no emails sent): the server mints
   sessions with the service-role key. Admins can optionally set a password on their profile page.
3. `cp apps/web/.env.example apps/web/.env.local` and fill in the project URL, anon key and **service-role key**
   (Project Settings → API; server-only, never `NEXT_PUBLIC_`).
4. `pnpm install && pnpm dev` → http://localhost:3000
5. Enter your email, then **Create a team** on the onboarding screen (you're admin). Share the join code (shown on the board) with paddlers.

`pnpm test` runs the algorithm package tests; `pnpm typecheck` / `pnpm lint` cover the app.

## Deploy (Vercel)

Import the repo, set **Root Directory** to `apps/web`, add the two `NEXT_PUBLIC_SUPABASE_*` env vars and `SUPABASE_SERVICE_ROLE_KEY`. pnpm workspaces are detected automatically.

## Free-tier gotchas

- Supabase free projects **pause after 7 days of no API activity**. A weekly RSVP is enough to keep it alive; otherwise un-pause from the dashboard (data is kept).
- Nominatim usage policy: max 1 request/s, and it requires an identifying User-Agent (set in `profile/actions.ts`). We only geocode when an address changes.
- Public OSRM is a demo server with no SLA. If it's down, the carpool map falls back to dashed straight lines; assignment itself never needs the network.

## To Do

- [x] Auth, teams (create/join by code), admin/member roles, RLS
- [x] Board with pinned announcements
- [x] Events (practice/race/social) + quick RSVP (attendance + ride + pickup spot)
- [x] Forms: admin builder (multi-event attendance + custom questions, draft/open/closed, duplicate),
      member fill page (profile prefilled, weight update, latest-wins), responses table + per-event summary + CSV
- [x] Pickup locations (team settings) used by RSVPs and the carpool map
- [x] Member profile (paddling stats, address geocoding, car info)
- [x] Admin: lineup builder (auto-fill, click-to-place/swap, L/R + F/B weight, publish, mastersheet copy)
- [x] Admin: carpool builder (optimizer, manual overrides, OSRM routes on map, publish)
- [x] Member view of published lineups/carpools per event
- [ ] File-upload questions (waiver screenshots) — needs Supabase Storage bucket
- [ ] Branching questions (e.g. "carpooling vs flying" sections)
- [ ] Attendance history & stats per paddler
- [x] Multiple lineups per practice shown side-by-side; race-day mode (heats)
- [ ] Notifications (email via Supabase / Resend free tier)
- [ ] Boat risk assessment (weather/wind/tide APIs — Open-Meteo is free)
- [ ] Multi-org switching for users in more than one team
- [ ] Migrate Supabase server to West coast one

<!-- deploy kick: verify restored Vercel git connection, 2026-09-02 -->
