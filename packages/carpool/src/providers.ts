// Every routing service the carpool tools can fall back on, in the order they're
// tried. Each one is just "how to ask" (an HttpRequest) and "how to read the answer"
// (normalised to OsrmRoute / CostMatrix) — no network calls happen here, the app
// does the fetching. All are free plans; the keyless public servers come first and a
// keyed one only joins the chain once its key is configured.

import { locationKey } from './geo'
import { buildOsrmTableUrl, parseOsrmTable, type CostMatrix } from './optimize'
import { buildOsrmRouteUrl, parseOsrmRoute, type OsrmRoute } from './routing'
import type { LatLon } from './types'

export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
export type ProviderKeys = Partial<Record<'ors' | 'locationiq' | 'geoapify' | 'mapbox' | 'tomtom' | 'graphhopper', string>>

type Base = {
  id: string
  /** Skipped unless this key is configured. */
  needsKey?: keyof ProviderKeys
  /** Skipped for requests with more points than this. */
  maxPoints?: number
}
export type RouteProvider = Base & { request(points: LatLon[], key?: string): HttpRequest; parse(json: unknown): OsrmRoute | null }
export type MatrixProvider = Base & { request(points: LatLon[], key?: string): HttpRequest; parse(points: LatLon[], json: unknown): CostMatrix | null }

const OSRM_DEMO = 'https://router.project-osrm.org'
const FOSSGIS_OSRM = 'https://routing.openstreetmap.de/routed-car'
const FOSSGIS_VALHALLA = 'https://valhalla1.openstreetmap.de'

const get = (url: string, headers?: Record<string, string>): HttpRequest => ({ url, method: 'GET', headers })
const post = (url: string, body: unknown, headers: Record<string, string> = {}): HttpRequest => ({
  url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
})
const withParam = (url: string, name: string, value: string) => `${url}${url.includes('?') ? '&' : '?'}${name}=${encodeURIComponent(value)}`
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Decode a Google-style encoded polyline (Valhalla uses precision 6) into [lon, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision
  const out: [number, number][] = []
  let i = 0, lat = 0, lon = 0
  while (i < encoded.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number
      do {
        b = encoded.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    out.push([lon / factor, lat / factor])
  }
  return out
}

const route = (distanceKm: number, durationMin: number, coordinates: [number, number][]): OsrmRoute => ({
  distanceKm, durationMin, geometry: { type: 'LineString', coordinates },
})

/** Square matrix over `points`, indexed by locationKey like parseOsrmTable. `cell` gives
 * [minutes, km] for i→j, or null when the service couldn't route that pair. */
function buildMatrix(points: LatLon[], cell: (i: number, j: number) => [number, number] | null): CostMatrix {
  const index = new Map<string, number>()
  points.forEach((p, i) => index.set(locationKey(p), i))
  const durationMin: (number | null)[][] = []
  const distanceKm: (number | null)[][] = []
  for (let i = 0; i < points.length; i++) {
    durationMin.push([]); distanceKm.push([])
    for (let j = 0; j < points.length; j++) {
      const c = cell(i, j)
      durationMin[i].push(c ? c[0] : null)
      distanceKm[i].push(c ? c[1] : null)
    }
  }
  return { index, durationMin, distanceKm }
}

/** A square matrix result that has the right number of rows — anything else is a
 * response we don't understand, and the next provider should get a turn. */
const square = (rows: unknown, n: number): rows is unknown[][] =>
  Array.isArray(rows) && rows.length === n && rows.every((r) => Array.isArray(r) && r.length === n)

// ---- OSRM-compatible services (OSRM itself, the FOSSGIS mirror, LocationIQ, Mapbox) ----

const osrmRoute = (id: string, base: string): RouteProvider => ({
  id, request: (pts) => get(buildOsrmRouteUrl(pts, base)), parse: parseOsrmRoute,
})
// OSRM's default table limit is 100 locations.
const osrmMatrix = (id: string, base: string): MatrixProvider => ({
  id, maxPoints: 100, request: (pts) => get(buildOsrmTableUrl(pts, base)), parse: parseOsrmTable,
})
const coords = (pts: LatLon[]) => pts.map((p) => `${p.lon},${p.lat}`).join(';')

// ---- Valhalla (FOSSGIS public server) ----

const valhallaLocs = (pts: LatLon[]) => pts.map((p) => ({ lat: p.lat, lon: p.lon }))

function parseValhallaRoute(json: unknown): OsrmRoute | null {
  const trip = obj(obj(json)?.trip)
  const summary = obj(trip?.summary)
  const km = num(summary?.length), sec = num(summary?.time)
  if (!trip || km == null || sec == null || !Array.isArray(trip.legs)) return null
  const line = (trip.legs as unknown[]).flatMap((l) => {
    const shape = obj(l)?.shape
    return typeof shape === 'string' ? decodePolyline(shape, 6) : []
  })
  return route(km, sec / 60, line)
}

function parseValhallaMatrix(points: LatLon[], json: unknown): CostMatrix | null {
  const rows = obj(json)?.sources_to_targets
  if (!square(rows, points.length)) return null
  return buildMatrix(points, (i, j) => {
    const c = obj(rows[i][j]), sec = num(c?.time), km = num(c?.distance)
    return sec != null && km != null ? [sec / 60, km] : null
  })
}

// ---- OpenRouteService ----

function parseOrsRoute(json: unknown): OsrmRoute | null {
  const f = obj((obj(json)?.features as unknown[] | undefined)?.[0])
  const s = obj(obj(f?.properties)?.summary), g = obj(f?.geometry)
  const m = num(s?.distance), sec = num(s?.duration)
  if (m == null || sec == null || g?.type !== 'LineString' || !Array.isArray(g.coordinates)) return null
  return route(m / 1000, sec / 60, g.coordinates as [number, number][])
}

function parseOrsMatrix(points: LatLon[], json: unknown): CostMatrix | null {
  const d = obj(json)
  if (!d || !square(d.durations, points.length) || !square(d.distances, points.length)) return null
  const dur = d.durations as unknown[][], dist = d.distances as unknown[][]
  return buildMatrix(points, (i, j) => {
    const sec = num(dur[i][j]), m = num(dist[i][j])
    return sec != null && m != null ? [sec / 60, m / 1000] : null
  })
}

// ---- Geoapify ----

function parseGeoapifyRoute(json: unknown): OsrmRoute | null {
  const f = obj((obj(json)?.features as unknown[] | undefined)?.[0])
  const p = obj(f?.properties), g = obj(f?.geometry)
  const m = num(p?.distance), sec = num(p?.time)
  if (m == null || sec == null || !g || !Array.isArray(g.coordinates)) return null
  const line = g.type === 'MultiLineString' ? (g.coordinates as [number, number][][]).flat() : (g.coordinates as [number, number][])
  return route(m / 1000, sec / 60, line)
}

function parseGeoapifyMatrix(points: LatLon[], json: unknown): CostMatrix | null {
  const rows = obj(json)?.sources_to_targets
  if (!square(rows, points.length)) return null
  return buildMatrix(points, (i, j) => {
    const c = obj(rows[i][j]), sec = num(c?.time), m = num(c?.distance)
    return sec != null && m != null ? [sec / 60, m / 1000] : null
  })
}

// ---- TomTom ----

function parseTomTomRoute(json: unknown): OsrmRoute | null {
  const r = obj((obj(json)?.routes as unknown[] | undefined)?.[0])
  const s = obj(r?.summary)
  const m = num(s?.lengthInMeters), sec = num(s?.travelTimeInSeconds)
  if (!r || m == null || sec == null || !Array.isArray(r.legs)) return null
  const line = (r.legs as unknown[]).flatMap((l) => {
    const pts = obj(l)?.points
    if (!Array.isArray(pts)) return []
    return pts.flatMap((p) => {
      const lon = num(obj(p)?.longitude), lat = num(obj(p)?.latitude)
      return lon != null && lat != null ? [[lon, lat] as [number, number]] : []
    })
  })
  return route(m / 1000, sec / 60, line)
}

// ---- GraphHopper ----

function parseGraphHopperRoute(json: unknown): OsrmRoute | null {
  const p = obj((obj(json)?.paths as unknown[] | undefined)?.[0])
  const m = num(p?.distance), ms = num(p?.time), g = obj(p?.points)
  if (m == null || ms == null || g?.type !== 'LineString' || !Array.isArray(g.coordinates)) return null
  return route(m / 1000, ms / 60000, g.coordinates as [number, number][])
}

// ---- The chains ----

export const ROUTE_PROVIDERS: RouteProvider[] = [
  osrmRoute('osrm', OSRM_DEMO),
  osrmRoute('fossgis-osrm', FOSSGIS_OSRM),
  {
    id: 'fossgis-valhalla',
    request: (pts) => post(`${FOSSGIS_VALHALLA}/route`, { locations: valhallaLocs(pts), costing: 'auto', units: 'kilometers' }),
    parse: parseValhallaRoute,
  },
  {
    id: 'ors', needsKey: 'ors', maxPoints: 50,
    request: (pts, key) => post('https://api.openrouteservice.org/v2/directions/driving-car/geojson', { coordinates: pts.map((p) => [p.lon, p.lat]) }, { Authorization: key! }),
    parse: parseOrsRoute,
  },
  {
    id: 'locationiq', needsKey: 'locationiq', maxPoints: 25,
    request: (pts, key) => get(withParam(`https://us1.locationiq.com/v1/directions/driving/${coords(pts)}?overview=full&geometries=geojson`, 'key', key!)),
    parse: parseOsrmRoute,
  },
  {
    id: 'geoapify', needsKey: 'geoapify', maxPoints: 50,
    request: (pts, key) => get(withParam(`https://api.geoapify.com/v1/routing?mode=drive&waypoints=${pts.map((p) => `${p.lat},${p.lon}`).join('|')}`, 'apiKey', key!)),
    parse: parseGeoapifyRoute,
  },
  {
    id: 'mapbox', needsKey: 'mapbox', maxPoints: 25,
    request: (pts, key) => get(withParam(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords(pts)}?overview=full&geometries=geojson`, 'access_token', key!)),
    parse: parseOsrmRoute,
  },
  {
    id: 'tomtom', needsKey: 'tomtom', maxPoints: 150,
    request: (pts, key) => get(withParam(`https://api.tomtom.com/routing/1/calculateRoute/${pts.map((p) => `${p.lat},${p.lon}`).join(':')}/json?travelMode=car`, 'key', key!)),
    parse: parseTomTomRoute,
  },
  {
    // Free plan: 5 points per request, so only short car routes fit.
    id: 'graphhopper', needsKey: 'graphhopper', maxPoints: 5,
    request: (pts, key) => get(withParam(`https://graphhopper.com/api/1/route?profile=car&points_encoded=false&${pts.map((p) => `point=${p.lat},${p.lon}`).join('&')}`, 'key', key!)),
    parse: parseGraphHopperRoute,
  },
]

// TomTom's matrix is left out on purpose: it's billed per cell, and its free 2,500
// cells a month is about two carpools. GraphHopper's free plan has no matrix at all.
export const MATRIX_PROVIDERS: MatrixProvider[] = [
  osrmMatrix('osrm', OSRM_DEMO),
  osrmMatrix('fossgis-osrm', FOSSGIS_OSRM),
  {
    id: 'fossgis-valhalla', maxPoints: 50,
    request: (pts) => post(`${FOSSGIS_VALHALLA}/sources_to_targets`, { sources: valhallaLocs(pts), targets: valhallaLocs(pts), costing: 'auto', units: 'kilometers' }),
    parse: parseValhallaMatrix,
  },
  {
    // Free plan caps a matrix at 3,500 cells.
    id: 'ors', needsKey: 'ors', maxPoints: 59,
    request: (pts, key) => post('https://api.openrouteservice.org/v2/matrix/driving-car', { locations: pts.map((p) => [p.lon, p.lat]), metrics: ['duration', 'distance'], units: 'm' }, { Authorization: key! }),
    parse: parseOrsMatrix,
  },
  {
    id: 'locationiq', needsKey: 'locationiq', maxPoints: 25,
    request: (pts, key) => get(withParam(`https://us1.locationiq.com/v1/matrix/driving/${coords(pts)}?annotations=duration,distance`, 'key', key!)),
    parse: parseOsrmTable,
  },
  {
    // 1,000 cells per request → 31 × 31.
    id: 'geoapify', needsKey: 'geoapify', maxPoints: 31,
    request: (pts, key) => {
      const locs = pts.map((p) => ({ location: [p.lon, p.lat] }))
      return post(withParam('https://api.geoapify.com/v1/routematrix', 'apiKey', key!), { mode: 'drive', sources: locs, targets: locs })
    },
    parse: parseGeoapifyMatrix,
  },
  {
    id: 'mapbox', needsKey: 'mapbox', maxPoints: 25,
    request: (pts, key) => get(withParam(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords(pts)}?annotations=duration,distance`, 'access_token', key!)),
    parse: parseOsrmTable,
  },
]
