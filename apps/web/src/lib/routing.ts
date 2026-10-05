// Drive times and routes for the carpool tools, from whichever free routing service
// will answer. Walks the provider chains in @db/carpool (keyless public servers first,
// then any keyed service whose env var is set) and returns the first good answer.
// Server-only — the keys must never reach the browser; the carpool builder goes
// through a server action for that reason.

import {
  MATRIX_PROVIDERS,
  ROUTE_PROVIDERS,
  type CostMatrix,
  type HttpRequest,
  type LatLon,
  type OsrmRoute,
  type ProviderKeys,
} from "@db/carpool";

// Optional keys, all free plans with no card needed except where noted. Any left unset
// are simply skipped.
//   ORS_API_KEY          openrouteservice.org — 2,000 routes + 500 matrices a day
//   LOCATIONIQ_API_KEY   locationiq.com — 5,000 requests a day, 2 a second
//   GEOAPIFY_API_KEY     geoapify.com — 3,000 credits a day
//   MAPBOX_ACCESS_TOKEN  mapbox.com — 100k routes + 100k matrix cells a month (may ask for a card)
//   TOMTOM_API_KEY       developer.tomtom.com — 20k routes a month
//   GRAPHHOPPER_API_KEY  graphhopper.com — 500 credits a day, routes of ≤5 points
const keys = (): ProviderKeys => ({
  ors: process.env.ORS_API_KEY,
  locationiq: process.env.LOCATIONIQ_API_KEY,
  geoapify: process.env.GEOAPIFY_API_KEY,
  mapbox: process.env.MAPBOX_ACCESS_TOKEN,
  tomtom: process.env.TOMTOM_API_KEY,
  graphhopper: process.env.GRAPHHOPPER_API_KEY,
});

/** A provider that just rate-limited us (or fell over) sits out this long, so a burst
 * of per-car requests moves straight to the next one instead of hammering it. Lives
 * as long as the warm server instance — good enough for one publish or cron run. */
const COOLDOWN_MS = 60_000;
const coolingUntil = new Map<string, number>();

type Provider<T> = { id: string; needsKey?: keyof ProviderKeys; maxPoints?: number; request(points: LatLon[], key?: string): HttpRequest; parse(json: unknown): T | null };

async function firstAnswer<T>(kind: "route" | "matrix", chain: Provider<T>[], points: LatLon[], timeoutMs: number): Promise<T | null> {
  const k = keys();
  for (const p of chain) {
    const key = p.needsKey ? k[p.needsKey] : undefined;
    if (p.needsKey && !key) continue;
    if (p.maxPoints && points.length > p.maxPoints) continue;
    const coolKey = p.id; // shared by route + matrix: same server, same rate limit
    if ((coolingUntil.get(coolKey) ?? 0) > Date.now()) continue;

    const req = p.request(points, key);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: { "User-Agent": "db-portal-carpool", ...req.headers },
        body: req.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) coolingUntil.set(coolKey, Date.now() + COOLDOWN_MS);
      if (!res.ok) { console.warn("[routing]", kind, p.id, res.status); continue; }
      const out = p.parse(await res.json());
      if (out) return out;
      console.warn("[routing]", kind, p.id, "unreadable response");
    } catch (err) {
      coolingUntil.set(coolKey, Date.now() + COOLDOWN_MS); // timeout or network failure
      console.warn("[routing]", kind, p.id, err instanceof Error ? err.name : err);
    }
  }
  console.warn("[routing]", kind, "every provider failed for", points.length, "points");
  return null;
}

/** One car's drive through `points` in order: km, minutes and the line for the map. */
export function routeDrive(points: LatLon[]): Promise<OsrmRoute | null> {
  if (points.length < 2) return Promise.resolve(null);
  return firstAnswer("route", ROUTE_PROVIDERS, points, 15000);
}

/** Drive time and distance between every pair of `points`. */
export function driveMatrix(points: LatLon[]): Promise<CostMatrix | null> {
  if (points.length < 2) return Promise.resolve(null);
  // The matrix parsers need the points too, to index rows by location.
  const chain = MATRIX_PROVIDERS.map((p) => ({ ...p, parse: (json: unknown) => p.parse(points, json) }));
  return firstAnswer("matrix", chain, points, 20000);
}
