-- Per-user, per-org opt-in email notification preferences (all off by default).
-- Senders always go through the service-role client (like Google Calendar/Sheets
-- sync), so the only RLS needed here is "you can read/write your own row" for
-- the settings page itself.

create table public.notification_prefs (
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  notify_email            text, -- optional override; null = send to the account's own email
  event_posted            boolean not null default false,
  deadline_reminder       boolean not null default false,
  event_signup            boolean not null default false, -- admin-only in the UI
  form_submitted          boolean not null default false, -- admin-only in the UI
  carpool_auto_generated  boolean not null default false, -- admin-only in the UI
  updated_at              timestamptz not null default now(),
  primary key (user_id, org_id)
);
alter table public.notification_prefs enable row level security;
create policy "notification_prefs self" on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- Stamped once a "deadline in 24h" reminder goes out, so the 10-minute cron
-- sweep never sends it twice.
alter table public.forms add column deadline_reminder_sent_at timestamptz;
alter table public.events add column deadline_reminder_sent_at timestamptz;
