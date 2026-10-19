import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessToken } from "@/lib/google-sheets";
import { htmlToText } from "@/lib/html";
import type { Event, GoogleCalendarSync } from "@/lib/database.types";

/** Two-way sync with a "team calendar" in the connected admin's Google account.
 * Portal → Google: pushed immediately from the event actions (via after()).
 * Google → portal: pulled by the 10-min cron with an incremental sync token.
 * Policy: Google-side deletes only UNLINK the portal event; edits are
 * last-write-wins on title/times/location; notes stay portal-authored;
 * events created in Google import as kind "other" flagged needs_info.
 * Teammates' birthdays are pushed too, as yearly all-day events (syncBirthdaysToGoogle);
 * the pull ignores all-day events, so they never come back as portal events. */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT = 10_000;

export class CalApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function calFetch(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new CalApiError(res.status, `calendar api ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

type GEvent = {
  id?: string; status?: string; summary?: string; description?: string; location?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  recurrence?: string[]; transparency?: string;
};

type EventWithGroup = Event & { group?: { name: string } | null };

function toGoogle(ev: EventWithGroup): GEvent {
  return {
    // Day rows carry auto titles ("Saturday 9/12") — the real name is the group's.
    summary: ev.group?.name ?? ev.title,
    location: ev.location_name ?? undefined,
    description: ev.notes ? htmlToText(ev.notes) : undefined,
    start: { dateTime: ev.starts_at },
    end: { dateTime: ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + 2 * 3600e3).toISOString() },
    extendedProperties: { private: { portalEventId: ev.id } },
  };
}

const eventsUrl = (calendarId: string, tail = "") => `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events${tail}`;

export async function getCalendarSync(orgId: string): Promise<GoogleCalendarSync | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("google_calendar_sync").select("*").eq("org_id", orgId).maybeSingle();
  return data ?? null;
}

export type WritableCalendar = { id: string; summary: string; primary: boolean };

/** The admin's calendars that can actually receive events — a calendar shared with
 * them read-only can't. Used to offer an existing calendar instead of a new one. */
export async function listWritableCalendars(userId: string): Promise<WritableCalendar[]> {
  const token = await getAccessToken(userId);
  const data = await calFetch(token, `${CAL_BASE}/users/me/calendarList?minAccessRole=writer&maxResults=250`);
  return ((data.items ?? []) as { id?: string; summary?: string; primary?: boolean; accessRole?: string; deleted?: boolean }[])
    .filter((c) => c.id && !c.deleted && (c.accessRole === "owner" || c.accessRole === "writer"))
    .map((c) => ({ id: c.id!, summary: c.summary?.trim() || c.id!, primary: !!c.primary }));
}

/** Store the mapping and mirror recent + future portal events into `calendarId`.
 * Shared by "create a new calendar" and "use one I already have". */
async function connectCalendar(orgId: string, userId: string, calendarId: string, syncToken: string | null): Promise<{ pushed: number }> {
  const token = await getAccessToken(userId);
  const admin = createAdminClient();
  // Any ids we're holding belong to the previously linked calendar — drop them so
  // the push below re-creates those events in the newly chosen one.
  await admin.from("events").update({ google_event_id: null }).eq("org_id", orgId).not("google_event_id", "is", null);
  const { error } = await admin.from("google_calendar_sync").upsert(
    { org_id: orgId, user_id: userId, calendar_id: calendarId, sync_token: syncToken }, { onConflict: "org_id" });
  if (error) throw new Error(error.message);

  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data: events } = await admin.from("events").select("*, group:event_groups(name)").eq("org_id", orgId).gte("starts_at", since).is("google_event_id", null);
  let pushed = 0;
  for (const ev of events ?? []) {
    try {
      const g = await calFetch(token, eventsUrl(calendarId), { method: "POST", body: JSON.stringify(toGoogle(ev)) });
      await admin.from("events").update({ google_event_id: g.id }).eq("id", ev.id);
      pushed++;
    } catch (err) { console.error("[gcal] initial push", ev.id, err); }
  }
  await syncBirthdaysToGoogle(orgId);
  return { pushed };
}

/** Create a fresh team calendar in the admin's Google account and mirror events into it. */
export async function createTeamCalendar(orgId: string, userId: string, name: string): Promise<{ pushed: number }> {
  const token = await getAccessToken(userId);
  const cal = await calFetch(token, `${CAL_BASE}/calendars`, { method: "POST", body: JSON.stringify({ summary: name }) });
  // Nothing pre-existing on a brand-new calendar, so no token to seed: the first
  // pull does its normal bounded initial sync.
  return connectCalendar(orgId, userId, cal.id as string, null);
}

/** Use a calendar the admin already has. Everything on it up to now stays put: we
 * take a sync token as of this moment and store it, so the first cron pull is
 * incremental from here rather than importing the calendar's back-history as
 * "missing info" events. Changes made after linking still flow in. */
export async function linkExistingCalendar(orgId: string, userId: string, calendarId: string): Promise<{ pushed: number }> {
  const token = await getAccessToken(userId);
  let syncToken: string | null = null;
  try {
    let pageToken: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ maxResults: "250", singleEvents: "true", timeMin: new Date().toISOString() });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await calFetch(token, eventsUrl(calendarId, `?${params}`));
      if (data.nextPageToken) { pageToken = data.nextPageToken; continue; } // items intentionally ignored
      syncToken = (data.nextSyncToken as string) ?? null;
      break;
    }
  } catch (err) {
    // Couldn't seed a token — fall back to a normal initial sync rather than
    // failing the link. Worst case the calendar's recent history imports.
    console.error("[gcal] seed sync token", calendarId, err);
  }
  return connectCalendar(orgId, userId, calendarId, syncToken);
}

/** Unlink the team calendar: keep the Google calendar and the portal events, drop the mapping. */
export async function disconnectTeamCalendar(orgId: string) {
  const admin = createAdminClient();
  await admin.from("events").update({ google_event_id: null }).eq("org_id", orgId).not("google_event_id", "is", null);
  await admin.from("google_calendar_sync").delete().eq("org_id", orgId);
}

/** Mirror one portal event to Google (create or update). Never throws — sync is best-effort.
 * Resolves true when the event is now in Google. */
export async function syncEventToGoogle(eventId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: ev } = await admin.from("events").select("*, group:event_groups(name)").eq("id", eventId).maybeSingle();
    if (!ev) return false;
    const sync = await getCalendarSync(ev.org_id);
    if (!sync) return false;
    const token = await getAccessToken(sync.user_id);
    if (ev.google_event_id) {
      try {
        await calFetch(token, eventsUrl(sync.calendar_id, `/${ev.google_event_id}`), { method: "PATCH", body: JSON.stringify(toGoogle(ev)) });
        return true;
      } catch (e) {
        if (!(e instanceof CalApiError && (e.status === 404 || e.status === 410))) throw e;
        // the Google copy is gone — fall through and create a fresh one
      }
    }
    const g = await calFetch(token, eventsUrl(sync.calendar_id), { method: "POST", body: JSON.stringify(toGoogle(ev)) });
    await admin.from("events").update({ google_event_id: g.id }).eq("id", ev.id);
    return true;
  } catch (err) {
    console.error("[gcal] push", eventId, err);
    return false;
  }
}

/** Remove the mirrored Google event after a portal delete. Never throws. */
export async function removeEventFromGoogle(orgId: string, googleEventId: string | null): Promise<void> {
  if (!googleEventId) return;
  try {
    const sync = await getCalendarSync(orgId);
    if (!sync) return;
    const token = await getAccessToken(sync.user_id);
    await calFetch(token, eventsUrl(sync.calendar_id, `/${googleEventId}`), { method: "DELETE" });
  } catch (err) {
    if (err instanceof CalApiError && (err.status === 404 || err.status === 410)) return; // already gone
    console.error("[gcal] remove", googleEventId, err);
  }
}

/** Pull time budget. A big backlog drains over several ticks: when the budget runs out
 * mid-way, the next page token is saved (as "page:<token>") and the next pull resumes. */
const PULL_BUDGET_MS = 15_000;
const PAGE_PREFIX = "page:";

/** Import changes made in Google Calendar since the last pull. Never throws — called from the cron. */
export async function pullGoogleCalendar(orgId: string, budgetMs = PULL_BUDGET_MS): Promise<{ applied: number; more?: boolean } | { error: string }> {
  const started = Date.now();
  try {
    const admin = createAdminClient();
    const sync = await getCalendarSync(orgId);
    if (!sync) return { applied: 0 };
    const token = await getAccessToken(sync.user_id);

    let applied = 0;
    let syncToken = sync.sync_token;
    let pageToken: string | undefined;
    if (syncToken?.startsWith(PAGE_PREFIX)) { pageToken = syncToken.slice(PAGE_PREFIX.length); syncToken = null; }
    let nextSyncToken: string | undefined;
    let retriedFull = false;
    for (;;) {
      // Initial sync is bounded (-30d … +180d); incremental syncs carry the token.
      // singleEvents expands recurrences so each occurrence maps to one portal event.
      const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
      if (pageToken) params.set("pageToken", pageToken);
      else if (syncToken) params.set("syncToken", syncToken);
      else {
        params.set("timeMin", new Date(Date.now() - 30 * 86400e3).toISOString());
        params.set("timeMax", new Date(Date.now() + 180 * 86400e3).toISOString());
      }
      let data;
      try {
        data = await calFetch(token, eventsUrl(sync.calendar_id, `?${params}`));
      } catch (e) {
        // Sync token expired (410), or a saved page token was rejected — full resync once.
        if (e instanceof CalApiError && (e.status === 410 || (e.status === 400 && pageToken)) && !retriedFull) {
          retriedFull = true; syncToken = null; pageToken = undefined; continue;
        }
        throw e;
      }
      for (const g of (data.items ?? []) as GEvent[]) {
        if (await applyGoogleItem(orgId, g)) applied++;
      }
      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
        if (Date.now() - started > budgetMs) {
          await admin.from("google_calendar_sync").update({ sync_token: PAGE_PREFIX + pageToken, updated_at: new Date().toISOString() }).eq("org_id", orgId);
          return { applied, more: true };
        }
        continue;
      }
      nextSyncToken = data.nextSyncToken;
      break;
    }
    if (nextSyncToken) {
      await admin.from("google_calendar_sync").update({ sync_token: nextSyncToken, updated_at: new Date().toISOString() }).eq("org_id", orgId);
    }
    return { applied };
  } catch (err) {
    console.error("[gcal] pull", orgId, err);
    return { error: err instanceof Error ? err.message : "pull failed" };
  }
}

/** Apply one changed Google event to the portal. Returns true when something was written. */
async function applyGoogleItem(orgId: string, g: GEvent): Promise<boolean> {
  // Our own birthday events (and instances of the old recurring ones), and all-day
  // events, are never imported — skip them before touching the database.
  if (!g.id || BIRTHDAY_ID.test(g.id)) return false;
  if (g.status !== "cancelled" && !g.start?.dateTime) return false;
  const admin = createAdminClient();
  const { data: byGid } = await admin.from("events").select("id, google_event_id, group:event_groups(name)").eq("org_id", orgId).eq("google_event_id", g.id).maybeSingle();
  let linked = byGid ?? null;
  const pid = g.extendedProperties?.private?.portalEventId;
  if (!linked && pid) {
    const { data: byPid } = await admin.from("events").select("id, google_event_id, group:event_groups(name)").eq("org_id", orgId).eq("id", pid).maybeSingle();
    linked = byPid ?? null;
  }

  if (g.status === "cancelled") {
    // Deleting in Google only unlinks — RSVPs/lineups/carpools are portal-only data.
    if (linked?.google_event_id) {
      await admin.from("events").update({ google_event_id: null }).eq("id", linked.id);
      return true;
    }
    return false;
  }
  if (!g.start?.dateTime) return false; // all-day events aren't imported — portal events are timed

  const summary = g.summary?.trim() || "Untitled event";
  const fields = {
    starts_at: new Date(g.start.dateTime).toISOString(),
    ends_at: g.end?.dateTime ? new Date(g.end.dateTime).toISOString() : null,
    location_name: g.location?.trim() || null,
  };
  if (linked) {
    // Last write wins on times/location. Grouped days push the GROUP name as the
    // Google summary, so only take it as the day title when it's a real rename.
    const groupName = (linked.group as { name: string } | null)?.name;
    const title = groupName && summary === groupName ? undefined : summary;
    await admin.from("events").update({ ...fields, ...(title ? { title } : {}), google_event_id: g.id }).eq("id", linked.id);
  } else {
    await admin.from("events").insert({ org_id: orgId, kind: "other", needs_info: true, google_event_id: g.id, title: summary, ...fields });
  }
  return true;
}

// ---------- birthdays ----------

/** Google writes per cron run — the first sync of a big roster finishes over a few ticks. */
const BIRTHDAY_WRITES_PER_RUN = 25;

/** One plain all-day event per teammate per year: `bd<user id hex><yyyy>`. The old
 * yearly-recurring ones (#130) were `bd<user id hex>` with no year. */
const BIRTHDAY_ID = /^bd[0-9a-f]{32}/;
const OUR_BIRTHDAY = /^bd([0-9a-f]{32})(\d{4})?$/;
const userHex = (userId: string) => userId.replace(/-/g, "");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** That year's birthday on the month/day only — the birth year never reaches Google.
 * Feb 29 birthdays fall on Feb 28 in non-leap years. */
export function toGoogleBirthday(userId: string, name: string, birthday: string, year: number): GEvent {
  let md = birthday.slice(5, 10); // "MM-DD"
  if (md === "02-29" && !isLeap(year)) md = "02-28";
  const [m, d] = md.split("-").map(Number);
  const day = (n: number) => new Date(Date.UTC(year, m - 1, d + n)).toISOString().slice(0, 10);
  return {
    id: `bd${userHex(userId)}${year}`,
    summary: `🎂 ${name}'s birthday`,
    start: { date: day(0) }, end: { date: day(1) },
    transparency: "transparent", // shows as free
    extendedProperties: { private: { portalBirthday: "1", portalUserId: userId, portalBirthdayYear: String(year) } },
  };
}

/** What a birthday sync would change: names (with the year) to add or fix, and how many
 * events of people no longer on the team (or old recurring ones) would be deleted. */
export type BirthdayPlan = { people: number; wanted: number; onCalendar: number; missing: string[]; outdated: string[]; stale: number };

const sameBirthday = (a: GEvent, b: GEvent) => a.summary === b.summary && a.start?.date === b.start?.date && !a.recurrence?.length;

/** Make the team calendar's birthdays match the roster: this year's and next year's
 * for everyone with a birthday (so each new year adds the following one). Removes all
 * of a person's birthday events once they leave the team or clear their birthday, and
 * the old recurring ones; past years stay for current teammates. One list call, then
 * writes only for what changed, 5 at a time, stopping at maxWrites or the deadline.
 * Never throws — called from the cron, on connect and by "Sync now". `dryRun` (the admin
 * Status page) only reports what's out of step, writing nothing. */
export async function syncBirthdaysToGoogle(
  orgId: string,
  { maxWrites = BIRTHDAY_WRITES_PER_RUN, deadline = Infinity, now = new Date(), dryRun = false }: { maxWrites?: number; deadline?: number; now?: Date; dryRun?: boolean } = {},
): Promise<{ written: number; left: number; plan?: BirthdayPlan } | { error: string }> {
  try {
    const sync = await getCalendarSync(orgId);
    if (!sync) return { written: 0, left: 0 };
    const admin = createAdminClient();
    const { data: members, error } = await admin.from("memberships").select("user_id, profile:profiles(full_name, birthday)").eq("org_id", orgId);
    if (error) throw new Error(error.message);
    const year = now.getFullYear();
    const want = new Map<string, GEvent>();
    const people = new Set<string>();
    for (const m of members ?? []) {
      const p = m.profile as unknown as { full_name: string | null; birthday: string | null } | null;
      if (!p?.birthday) continue;
      people.add(userHex(m.user_id));
      for (const y of [year, year + 1]) {
        const ev = toGoogleBirthday(m.user_id, p.full_name?.trim() || "Teammate", p.birthday, y);
        want.set(ev.id!, ev);
      }
    }

    const token = await getAccessToken(sync.user_id);
    const have = new Map<string, GEvent>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ privateExtendedProperty: "portalBirthday=1", maxResults: "250" });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await calFetch(token, eventsUrl(sync.calendar_id, `?${params}`));
      for (const g of (data.items ?? []) as GEvent[]) if (g.id && g.status !== "cancelled") have.set(g.id, g);
      pageToken = data.nextPageToken;
    } while (pageToken);

    const ops: (() => Promise<void>)[] = [];
    const plan: BirthdayPlan = { people: people.size, wanted: want.size, onCalendar: have.size, missing: [], outdated: [], stale: 0 };
    for (const id of have.keys()) {
      const m = id.match(OUR_BIRTHDAY);
      if (!m || (m[2] && people.has(m[1]))) continue; // not ours, or a current teammate's
      plan.stale++;
      ops.push(async () => {
        try { await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "DELETE" }); }
        catch (e) { if (!(e instanceof CalApiError && (e.status === 404 || e.status === 410))) throw e; }
      });
    }
    for (const [id, ev] of want) {
      const cur = have.get(id);
      if (cur && sameBirthday(cur, ev)) continue;
      (cur ? plan.outdated : plan.missing).push(ev.summary!.replace(/^🎂 |'s birthday$/g, "") + ` (${id.slice(-4)})`);
      ops.push(async () => {
        if (cur) { await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "PUT", body: JSON.stringify(ev) }); return; }
        try {
          await calFetch(token, eventsUrl(sync.calendar_id), { method: "POST", body: JSON.stringify(ev) });
        } catch (e) {
          // 409: this id was used before and deleted — bring it back instead.
          if (!(e instanceof CalApiError && e.status === 409)) throw e;
          await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "PUT", body: JSON.stringify({ ...ev, status: "confirmed" }) });
        }
      });
    }

    if (dryRun) return { written: 0, left: ops.length, plan };
    let written = 0, done = 0;
    while (done < ops.length && written < maxWrites && Date.now() < deadline) {
      const batch = ops.slice(done, done + Math.min(5, maxWrites - written));
      const results = await Promise.allSettled(batch.map((op) => op()));
      for (const r of results) if (r.status === "fulfilled") written++; else console.error("[gcal] birthday", r.reason);
      done += batch.length;
    }
    return { written, left: ops.length - done };
  } catch (err) {
    console.error("[gcal] birthdays", orgId, err);
    return { error: err instanceof Error ? err.message : "birthday sync failed" };
  }
}

/** Settings "Sync now": the cron's work right away, plus a full re-push so Google
 * matches the portal. Pulls first, so Google-side edits since the last tick aren't
 * overwritten by the push. Stops cleanly before Vercel's limit; the cron finishes. */
export async function syncTeamCalendarNow(orgId: string, budgetMs = 45_000): Promise<{ pulled: number; pushed: number; failed: number; birthdays: number; more: boolean } | { error: string }> {
  const deadline = Date.now() + budgetMs;
  if (!(await getCalendarSync(orgId))) return { error: "No team calendar is connected." };
  const pull = await pullGoogleCalendar(orgId, budgetMs / 3);
  if ("error" in pull) return { error: `Couldn't read Google Calendar: ${pull.error}` };
  let more = !!pull.more;

  const since = new Date(Date.now() - 30 * 86400e3).toISOString(); // same window as connecting
  const { data: events } = await createAdminClient().from("events").select("id").eq("org_id", orgId).gte("starts_at", since).order("starts_at");
  let pushed = 0, failed = 0;
  const ids = (events ?? []).map((e) => e.id);
  for (let i = 0; i < ids.length; i += 5) {
    if (Date.now() >= deadline) { more = true; break; }
    const results = await Promise.all(ids.slice(i, i + 5).map(syncEventToGoogle));
    pushed += results.filter(Boolean).length;
    failed += results.length - results.filter(Boolean).length;
  }

  const b = await syncBirthdaysToGoogle(orgId, { maxWrites: Infinity, deadline });
  if ("error" in b) return { error: `Events synced, but birthdays failed: ${b.error}` };
  return { pulled: pull.applied, pushed, failed, birthdays: b.written, more: more || b.left > 0 };
}
