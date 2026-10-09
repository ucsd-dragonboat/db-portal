// Address → coordinates via Nominatim (OpenStreetMap's free geocoder). Server-only.
// Nominatim allows one request a second, so calls made by this server instance are
// spaced out; the callers only geocode text that actually changed.

import { buildNominatimSearchUrl, parseNominatimResult, type LatLon } from "@db/carpool";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { demoGeoAllowed } from "@/lib/demo";

const MIN_GAP_MS = 1100;
let lastCall = 0;

/** Coordinates for `query`, or null when it's blank, not found, or the lookup failed
 * (or, for a demo sandbox `orgId`, when its daily lookup budget is spent). */
export async function geocode(query: string, orgId?: string): Promise<LatLon | null> {
  const q = query.trim();
  if (!q) return null;
  if (!(await demoGeoAllowed(orgId, "nominatim"))) return null;
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const res = await fetch(buildNominatimSearchUrl(q), {
      headers: { "User-Agent": "db-team-portal (contact via app admin)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return parseNominatimResult(await res.json());
  } catch {
    return null;
  }
}

type PickupRow = { event_id: string; pickup_address: string | null };

/** Fills pickup_lat/pickup_lon on RSVP rows about to be saved for `userId`. Text that
 * matches what's already stored keeps its stored coordinates; new text is geocoded
 * once per distinct address (biased to the member's home city when the text doesn't
 * name one). Returns the addresses that couldn't be found, so the member can be told. */
export async function attachPickupCoords<R extends PickupRow>(
  supabase: SupabaseClient<Database>, userId: string, rows: R[], orgId?: string,
): Promise<{ rows: (R & { pickup_lat: number | null; pickup_lon: number | null })[]; notFound: string[] }> {
  const typed = rows.filter((r) => r.pickup_address);
  const [{ data: existing }, { data: profile }] = typed.length
    ? await Promise.all([
        supabase.from("rsvps").select("event_id, pickup_address, pickup_lat, pickup_lon").eq("user_id", userId).in("event_id", typed.map((r) => r.event_id)),
        supabase.from("profiles").select("city").eq("id", userId).maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];
  const stored = new Map((existing ?? []).map((e) => [e.event_id, e]));
  const city = profile?.city?.trim();
  const looked = new Map<string, LatLon | null>();
  const notFound = new Set<string>();

  const out = [];
  for (const r of rows) {
    const text = r.pickup_address?.trim();
    if (!text) { out.push({ ...r, pickup_lat: null, pickup_lon: null }); continue; }
    const prev = stored.get(r.event_id);
    if (prev?.pickup_address === text && prev.pickup_lat != null && prev.pickup_lon != null) {
      out.push({ ...r, pickup_lat: prev.pickup_lat, pickup_lon: prev.pickup_lon });
      continue;
    }
    if (!looked.has(text)) {
      const query = city && !text.toLowerCase().includes(city.toLowerCase()) ? `${text}, ${city}` : text;
      looked.set(text, (await geocode(query, orgId)) ?? (query !== text ? await geocode(text, orgId) : null));
    }
    const loc = looked.get(text) ?? null;
    if (!loc) notFound.add(text);
    out.push({ ...r, pickup_lat: loc?.lat ?? null, pickup_lon: loc?.lon ?? null });
  }
  return { rows: out, notFound: [...notFound] };
}

/** The member-facing note for addresses that couldn't be placed on the map. */
export const notFoundWarning = (notFound: string[]) =>
  notFound.length
    ? `Saved — but we couldn't find ${notFound.map((a) => `“${a}”`).join(", ")} on the map, so the coach will see ${notFound.length > 1 ? "them" : "it"} as text only. Try adding a street and city.`
    : undefined;
