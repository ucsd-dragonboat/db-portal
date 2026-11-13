"use server";

import {
  detectColumns, haversineKm, matchSpot, parseAttending, sheetResponses,
  type LatLon, type Origin, type SheetColumns, type SheetEntry,
} from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { geocode } from "@/lib/geocode";
import { getAccessToken, getSheetTabs, parseSheetUrl, readValues, SheetApiError } from "@/lib/google-sheets";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Found further than this from the day's location = a joke answer that matched some
 * other town ("crack", "orgy") — treated as not found. */
const MAX_ORIGIN_KM = 150;
/** New lookups per import (Nominatim allows ~1/s). Text already found is reused, so a
 * re-import picks up the rest. */
const MAX_LOOKUPS = 40;

export type SheetPreview = {
  tabs: string[]; tab: string; header: string[]; hasHeader: boolean;
  sample: string[][]; rowCount: number; cols: SheetColumns | null;
};

function sheetError(e: unknown): { error: string } {
  if (e instanceof Error && e.message === "google_unlinked") return { error: "Connect your Google account first (Link to Sheets), then try again." };
  if (e instanceof SheetApiError && (e.status === 403 || e.status === 404)) return { error: "Couldn't open that sheet with your Google account — check the link and sharing." };
  return { error: "Couldn't reach Google Sheets — try again." };
}

/** A tab of the response sheet: its header (or none, when the first row is already
 * answers) and the rows under it. */
async function loadTab(userId: string, url: string, tab: string | null) {
  const parsed = parseSheetUrl(url);
  if (!parsed) throw new Error("bad_url");
  const token = await getAccessToken(userId);
  const tabs = await getSheetTabs(token, parsed.spreadsheetId);
  const picked = tabs.find((t) => t.title === tab) ?? tabs.find((t) => t.sheetId === parsed.gid) ?? tabs[0];
  if (!picked) throw new Error("no_tabs");
  const values = (await readValues(token, parsed.spreadsheetId, picked.title)).filter((r) => r.some((c) => c.trim()));
  const hasHeader = !!values.length && !values[0].some((c) => parseAttending(c)?.col);
  const header = hasHeader ? values[0] : [];
  return { tabs: tabs.map((t) => t.title), tab: picked.title, header, hasHeader, rows: hasHeader ? values.slice(1) : values };
}

/** Step 1 of an import: read the sheet and guess its columns, for the admin to check. */
export async function readResponseSheet(url: string, tab: string | null): Promise<SheetPreview | { error: string }> {
  const { org, userId } = await requireAdmin();
  if (org.is_demo) return { error: "Demo teams can't link Google Sheets." };
  try {
    const t = await loadTab(userId, url, tab);
    const width = Math.max(t.header.length, ...t.rows.map((r) => r.length));
    const header = Array.from({ length: width }, (_, i) => t.header[i] ?? "");
    return { tabs: t.tabs, tab: t.tab, header, hasHeader: t.hasHeader, sample: t.rows.slice(0, 3), rowCount: t.rows.length, cols: detectColumns(header, t.rows) };
  } catch (e) {
    if (e instanceof Error && e.message === "bad_url") return { error: "That doesn't look like a Google Sheet URL." };
    if (e instanceof Error && e.message === "no_tabs") return { error: "That spreadsheet has no tabs." };
    return sheetError(e);
  }
}

/** Where people can start from without a lookup: the team's pickup spots and saved
 * locations that have coordinates. */
async function knownSpots(supabase: Supabase, orgId: string) {
  const [{ data: pickups }, { data: saved }] = await Promise.all([
    supabase.from("pickup_locations").select("name, lat, lon").eq("org_id", orgId).eq("active", true),
    supabase.from("saved_locations").select("name, lat, lon").eq("org_id", orgId),
  ]);
  return [...(pickups ?? []), ...(saved ?? [])].filter((s): s is { name: string; lat: number; lon: number } => s.lat != null && s.lon != null);
}

async function dayDestination(supabase: Supabase, orgId: string, eventId: string): Promise<LatLon | null> {
  const { data: ev } = await supabase.from("events").select("location_lat, location_lon").eq("id", eventId).eq("org_id", orgId).maybeSingle();
  return ev?.location_lat != null && ev.location_lon != null ? { lat: ev.location_lat, lon: ev.location_lon } : null;
}

/** Text → a place: a pickup spot / saved location by name, else a map lookup that
 * has to land near the day's location. */
async function resolve(text: string, spots: { name: string; lat: number; lon: number }[], near: LatLon | null, orgId: string): Promise<LatLon | null> {
  const spot = matchSpot(text, spots);
  if (spot) return { lat: spot.lat, lon: spot.lon };
  const loc = await geocode(text, orgId);
  return loc && (!near || haversineKm(loc, near) <= MAX_ORIGIN_KM) ? loc : null;
}

/** Step 2: every response (latest per person) with where they start from. `known` is
 * the layout's current origins, so text already looked up isn't looked up again. */
export async function importResponseSheet(eventId: string, url: string, tab: string, cols: SheetColumns, known: Record<string, Origin>):
  Promise<{ entries: SheetEntry[]; notFound: string[]; skipped: number } | { error: string }> {
  const { org, userId } = await requireAdmin();
  if (org.is_demo) return { error: "Demo teams can't link Google Sheets." };
  const supabase = await createClient();
  let rows: string[][];
  try { rows = (await loadTab(userId, url, tab)).rows; } catch (e) { return sheetError(e); }
  const [spots, near] = await Promise.all([knownSpots(supabase, org.id), dayDestination(supabase, org.id, eventId)]);
  const cache = new Map<string, LatLon | null>();
  for (const o of Object.values(known ?? {})) if (typeof o?.text === "string" && o.location) cache.set(o.text.trim().toLowerCase(), o.location);

  const entries: SheetEntry[] = [];
  const notFound: string[] = [];
  let lookups = 0, skipped = 0;
  for (const r of sheetResponses(rows, cols)) {
    // Someone getting there themselves isn't routed, so their place isn't looked up.
    let location: LatLon | null = null;
    const k = r.location.toLowerCase();
    if (r.col && r.col !== "diy" && r.location) {
      const spot = matchSpot(r.location, spots);
      if (spot) location = { lat: spot.lat, lon: spot.lon };
      else if (cache.has(k)) location = cache.get(k)!;
      else if (lookups < MAX_LOOKUPS) {
        lookups++;
        location = await resolve(r.location, spots, near, org.id);
        cache.set(k, location);
      } else { skipped++; entries.push({ key: r.key, name: r.name, col: r.col, origin: r.location, location }); continue; }
      if (!location) notFound.push(`${r.name} (“${r.location}”)`);
    }
    entries.push({ key: r.key, name: r.name, col: r.col, origin: r.location, location });
  }
  return { entries, notFound, skipped };
}

/** The Origins panel: look up one person's starting point for this layout. */
export async function findOrigin(eventId: string, text: string): Promise<{ location: LatLon | null }> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const t = text.trim().slice(0, 200);
  if (!t) return { location: null };
  const [spots, near] = await Promise.all([knownSpots(supabase, org.id), dayDestination(supabase, org.id, eventId)]);
  return { location: await resolve(t, spots, near, org.id) };
}
