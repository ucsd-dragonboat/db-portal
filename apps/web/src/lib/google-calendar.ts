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

/** Import changes made in Google Calendar since the last pull. Never throws — called from the cron. */
export async function pullGoogleCalendar(orgId: string): Promise<{ applied: number } | { error: string }> {
  try {
    const admin = createAdminClient();
    const sync = await getCalendarSync(orgId);
    if (!sync) return { applied: 0 };
    const token = await getAccessToken(sync.user_id);

    let applied = 0;
    let syncToken = sync.sync_token;
    let pageToken: string | undefined;
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
        if (e instanceof CalApiError && e.status === 410 && !retriedFull) { // sync token expired — full resync once
          retriedFull = true; syncToken = null; pageToken = undefined; continue;
        }
        throw e;
      }
      for (const g of (data.items ?? []) as GEvent[]) {
        if (await applyGoogleItem(orgId, g)) applied++;
      }
      if (data.nextPageToken) { pageToken = data.nextPageToken; continue; }
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
  if (!g.id) return false;
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

/** Google writes per call — the first sync of a big roster finishes over a few cron ticks. */
const BIRTHDAY_WRITES_PER_RUN = 25;

/** Stable Google event id per teammate (base32hex: 0-9 a-v), so no mapping table is needed. */
const birthdayEventId = (userId: string) => `bd${userId.replace(/-/g, "")}`;

/** Yearly all-day event on the month/day only — the birth year never reaches Google. */
export function toGoogleBirthday(userId: string, name: string, birthday: string): GEvent {
  const md = birthday.slice(5, 10); // "MM-DD"
  const start = `2000-${md}`; // 2000 is a leap year, so 02-29 is a real date
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return {
    id: birthdayEventId(userId),
    summary: `🎂 ${name}'s birthday`,
    start: { date: start }, end: { date: end },
    // Feb 29 birthdays fall on Feb 28 in non-leap years.
    recurrence: [md === "02-29" ? "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1" : "RRULE:FREQ=YEARLY"],
    transparency: "transparent", // shows as free
    extendedProperties: { private: { portalBirthday: "1", portalUserId: userId } },
  };
}

const sameBirthday = (a: GEvent, b: GEvent) =>
  a.summary === b.summary && a.start?.date === b.start?.date && (a.recurrence ?? []).join() === (b.recurrence ?? []).join();

/** Make the team calendar's birthday events match the roster: add new or changed
 * birthdays, remove ones for people who left or cleared theirs. One list call, then
 * writes only for what changed. Never throws — called from the cron and on connect. */
export async function syncBirthdaysToGoogle(orgId: string, maxWrites = BIRTHDAY_WRITES_PER_RUN): Promise<{ written: number } | { error: string }> {
  try {
    const sync = await getCalendarSync(orgId);
    if (!sync) return { written: 0 };
    const admin = createAdminClient();
    const { data: members, error } = await admin.from("memberships").select("user_id, profile:profiles(full_name, birthday)").eq("org_id", orgId);
    if (error) throw new Error(error.message);
    const want = new Map<string, GEvent>();
    for (const m of members ?? []) {
      const p = m.profile as unknown as { full_name: string | null; birthday: string | null } | null;
      if (p?.birthday) want.set(birthdayEventId(m.user_id), toGoogleBirthday(m.user_id, p.full_name?.trim() || "Teammate", p.birthday));
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

    let written = 0;
    for (const [id, ev] of want) {
      if (written >= maxWrites) break;
      const cur = have.get(id);
      if (cur && sameBirthday(cur, ev)) continue;
      try {
        if (cur) await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "PUT", body: JSON.stringify(ev) });
        else {
          try {
            await calFetch(token, eventsUrl(sync.calendar_id), { method: "POST", body: JSON.stringify(ev) });
          } catch (e) {
            // 409: this id was used before and deleted — bring it back instead.
            if (!(e instanceof CalApiError && e.status === 409)) throw e;
            await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "PUT", body: JSON.stringify({ ...ev, status: "confirmed" }) });
          }
        }
        written++;
      } catch (err) { console.error("[gcal] birthday", id, err); }
    }
    for (const id of have.keys()) {
      if (want.has(id) || written >= maxWrites) continue;
      try { await calFetch(token, eventsUrl(sync.calendar_id, `/${id}`), { method: "DELETE" }); written++; }
      catch (err) { if (!(err instanceof CalApiError && (err.status === 404 || err.status === 410))) console.error("[gcal] birthday remove", id, err); }
    }
    return { written };
  } catch (err) {
    console.error("[gcal] birthdays", orgId, err);
    return { error: err instanceof Error ? err.message : "birthday sync failed" };
  }
}

/** Settings "Sync now": the cron's work right away, plus a full re-push so Google
 * matches the portal. Pulls first, so Google-side edits since the last tick aren't
 * overwritten by the push. */
export async function syncTeamCalendarNow(orgId: string): Promise<{ pulled: number; pushed: number; failed: number; birthdays: number } | { error: string }> {
  if (!(await getCalendarSync(orgId))) return { error: "No team calendar is connected." };
  const pull = await pullGoogleCalendar(orgId);
  if ("error" in pull) return { error: `Couldn't read Google Calendar: ${pull.error}` };

  const since = new Date(Date.now() - 30 * 86400e3).toISOString(); // same window as connecting
  const { data: events } = await createAdminClient().from("events").select("id").eq("org_id", orgId).gte("starts_at", since).order("starts_at");
  let pushed = 0, failed = 0;
  const ids = (events ?? []).map((e) => e.id);
  for (let i = 0; i < ids.length; i += 5) {
    const results = await Promise.all(ids.slice(i, i + 5).map(syncEventToGoogle));
    pushed += results.filter(Boolean).length;
    failed += results.length - results.filter(Boolean).length;
  }

  const b = await syncBirthdaysToGoogle(orgId, Infinity);
  if ("error" in b) return { error: `Events synced, but birthdays failed: ${b.error}` };
  return { pulled: pull.applied, pushed, failed, birthdays: b.written };
}
