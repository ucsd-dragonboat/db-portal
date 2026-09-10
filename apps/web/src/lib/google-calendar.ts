import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessToken } from "@/lib/google-sheets";
import { htmlToText } from "@/lib/html";
import type { Event, GoogleCalendarSync } from "@/lib/database.types";

/** Two-way sync with a "team calendar" in the connected admin's Google account.
 * Portal → Google: pushed immediately from the event actions (via after()).
 * Google → portal: pulled by the 10-min cron with an incremental sync token.
 * Policy: Google-side deletes only UNLINK the portal event; edits are
 * last-write-wins on title/times/location; notes stay portal-authored;
 * events created in Google import as kind "other" flagged needs_info. */

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
};

function toGoogle(ev: Event): GEvent {
  return {
    summary: ev.title,
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

/** Create the team calendar in the admin's Google account and mirror recent + future events into it. */
export async function createTeamCalendar(orgId: string, userId: string, name: string): Promise<{ pushed: number }> {
  const token = await getAccessToken(userId);
  const cal = await calFetch(token, `${CAL_BASE}/calendars`, { method: "POST", body: JSON.stringify({ summary: name }) });
  const admin = createAdminClient();
  const { error } = await admin.from("google_calendar_sync").upsert(
    { org_id: orgId, user_id: userId, calendar_id: cal.id as string, sync_token: null }, { onConflict: "org_id" });
  if (error) throw new Error(error.message);

  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data: events } = await admin.from("events").select("*").eq("org_id", orgId).gte("starts_at", since).is("google_event_id", null);
  let pushed = 0;
  for (const ev of events ?? []) {
    try {
      const g = await calFetch(token, eventsUrl(cal.id), { method: "POST", body: JSON.stringify(toGoogle(ev)) });
      await admin.from("events").update({ google_event_id: g.id }).eq("id", ev.id);
      pushed++;
    } catch (err) { console.error("[gcal] initial push", ev.id, err); }
  }
  return { pushed };
}

/** Unlink the team calendar: keep the Google calendar and the portal events, drop the mapping. */
export async function disconnectTeamCalendar(orgId: string) {
  const admin = createAdminClient();
  await admin.from("events").update({ google_event_id: null }).eq("org_id", orgId).not("google_event_id", "is", null);
  await admin.from("google_calendar_sync").delete().eq("org_id", orgId);
}

/** Mirror one portal event to Google (create or update). Never throws — sync is best-effort. */
export async function syncEventToGoogle(eventId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ev } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
    if (!ev) return;
    const sync = await getCalendarSync(ev.org_id);
    if (!sync) return;
    const token = await getAccessToken(sync.user_id);
    if (ev.google_event_id) {
      try {
        await calFetch(token, eventsUrl(sync.calendar_id, `/${ev.google_event_id}`), { method: "PATCH", body: JSON.stringify(toGoogle(ev)) });
        return;
      } catch (e) {
        if (!(e instanceof CalApiError && (e.status === 404 || e.status === 410))) throw e;
        // the Google copy is gone — fall through and create a fresh one
      }
    }
    const g = await calFetch(token, eventsUrl(sync.calendar_id), { method: "POST", body: JSON.stringify(toGoogle(ev)) });
    await admin.from("events").update({ google_event_id: g.id }).eq("id", ev.id);
  } catch (err) {
    console.error("[gcal] push", eventId, err);
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
  const { data: byGid } = await admin.from("events").select("id, google_event_id").eq("org_id", orgId).eq("google_event_id", g.id).maybeSingle();
  let linked = byGid ?? null;
  const pid = g.extendedProperties?.private?.portalEventId;
  if (!linked && pid) {
    const { data: byPid } = await admin.from("events").select("id, google_event_id").eq("org_id", orgId).eq("id", pid).maybeSingle();
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

  const fields = {
    title: g.summary?.trim() || "Untitled event",
    starts_at: new Date(g.start.dateTime).toISOString(),
    ends_at: g.end?.dateTime ? new Date(g.end.dateTime).toISOString() : null,
    location_name: g.location?.trim() || null,
  };
  if (linked) {
    // Last write wins on title/times/location. Notes/kind/group stay portal-authored.
    await admin.from("events").update({ ...fields, google_event_id: g.id }).eq("id", linked.id);
  } else {
    await admin.from("events").insert({ org_id: orgId, kind: "other", needs_info: true, google_event_id: g.id, ...fields });
  }
  return true;
}
