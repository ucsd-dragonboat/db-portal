// Pure helpers for the Sheets-style rides layout (CarpoolDataV2): legacy-data
// upgrade, per-direction reconciliation against current RSVPs, placement, the
// TOTAL-panel campus grouping, and the discrepancy tracker.

import type { Car, CarpoolDataV2, CarpoolGuest, DirSet, LatLon } from './types'
import { locationKey } from './geo'
import { DEFAULT_CARPOOL_HEADER, DEFAULT_COLLEGE_KEYWORDS } from './types'

const GUEST_COLS = new Set(['drivers', 'offCampus', 'onCampus', 'diy'])
const isGuest = (x: unknown): x is CarpoolGuest => {
  const g = x as CarpoolGuest
  return !!g && typeof g === 'object' && typeof g.id === 'string' && typeof g.name === 'string' && GUEST_COLS.has(g.col)
}

/** riderId → text the campus keywords match against (name + pickup-location name). */
export type MatchText = Record<string, string>

export type DirPrefix = 'g' | 'b'

const emptyDir = (): DirSet => ({ onCampus: [], offCampus: [], diy: [] })

/** First keyword (in list order) appearing case-insensitively in `text`, else null. */
export function matchKeyword(text: string, keywords: string[]): string | null {
  const t = text.toLowerCase()
  for (const k of keywords) {
    const needle = k.trim().toLowerCase()
    if (needle && t.includes(needle)) return k
  }
  return null
}

/** Split cars into on/off-campus grids by the DRIVER's keyword match. */
export function splitByCampus(cars: Car[], matchText: MatchText, keywords: string[]): { onCampus: Car[]; offCampus: Car[] } {
  const onCampus: Car[] = []
  const offCampus: Car[] = []
  for (const c of cars) (matchKeyword(matchText[c.driverId] ?? '', keywords) ? onCampus : offCampus).push(c)
  return { onCampus, offCampus }
}

const isCar = (x: unknown): x is Car => {
  const c = x as Car
  return !!c && typeof c === 'object' && typeof c.driverId === 'string' && typeof c.capacity === 'number' && Array.isArray(c.passengerIds)
}

const cleanCars = (raw: unknown, prefix: DirPrefix): Car[] =>
  (Array.isArray(raw) ? raw.filter(isCar) : []).map((c) => {
    const { comment, ...rest } = c
    return {
      ...rest,
      id: `${prefix}:${c.driverId}`,
      passengerIds: c.passengerIds.filter((p): p is string => typeof p === 'string'),
      ...(typeof comment === 'string' && comment.trim() ? { comment: comment.slice(0, 500) } : {}),
    }
  })

const cleanDir = (raw: unknown, prefix: DirPrefix): DirSet => {
  const d = (raw ?? {}) as Partial<DirSet>
  return {
    onCampus: cleanCars(d.onCampus, prefix),
    offCampus: cleanCars(d.offCampus, prefix),
    diy: Array.isArray(d.diy) ? d.diy.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Total upgrade-on-read: v2 rows are normalized, legacy `{cars,mode}` rows are
 * migrated (cars → going, split by campus; back empty), anything else becomes an
 * empty sheet. Never throws. */
export function upgradeCarpoolData(raw: unknown, matchText: MatchText): CarpoolDataV2 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.v === 2) {
    return {
      v: 2,
      header: typeof r.header === 'string' ? r.header : DEFAULT_CARPOOL_HEADER,
      funFactQuestionId: typeof r.funFactQuestionId === 'string' ? r.funFactQuestionId : null,
      collegeKeywords: Array.isArray(r.collegeKeywords) && r.collegeKeywords.length
        ? r.collegeKeywords.filter((k): k is string => typeof k === 'string')
        : [...DEFAULT_COLLEGE_KEYWORDS],
      guests: Array.isArray(r.guests) ? r.guests.filter(isGuest) : [],
      going: cleanDir(r.going, 'g'),
      back: cleanDir(r.back, 'b'),
      ...(r.seatedAt && typeof r.seatedAt === 'object'
        ? { seatedAt: Object.fromEntries(Object.entries(r.seatedAt as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')) }
        : {}),
    }
  }
  const legacy = cleanCars(r.cars, 'g')
  return {
    v: 2,
    header: DEFAULT_CARPOOL_HEADER,
    funFactQuestionId: null,
    collegeKeywords: [...DEFAULT_COLLEGE_KEYWORDS],
    guests: [],
    going: { ...splitByCampus(legacy, matchText, DEFAULT_COLLEGE_KEYWORDS), diy: [] },
    back: emptyDir(),
  }
}

/** Re-project one direction onto the CURRENT drivers/riders: cars whose driver
 * left the event drop (typed-in drivers survive as long as they're still riders),
 * new RSVP'd drivers get a blank car in the grid their keyword match picks,
 * passengers and DIY are filtered to known riders, and a rider seated twice keeps
 * only the first placement. */
export function reconcileDirSet(
  dir: DirSet,
  drivers: { id: string; seats: number }[],
  riderIds: Set<string>,
  matchText: MatchText,
  keywords: string[],
  prefix: DirPrefix,
): DirSet {
  const seatsBy = new Map(drivers.map((d) => [d.id, d.seats]))
  const seen = new Set<string>()
  const keep = (cars: Car[]): Car[] =>
    cars.filter((c) => riderIds.has(c.driverId)).map((c) => ({
      ...c,
      id: `${prefix}:${c.driverId}`,
      capacity: c.capacity || seatsBy.get(c.driverId) || 1,
      passengerIds: c.passengerIds.filter((p) => {
        if (!riderIds.has(p) || seen.has(p)) return false
        seen.add(p)
        return true
      }),
    }))
  const onCampus = keep(dir.onCampus)
  const offCampus = keep(dir.offCampus)
  const placedDrivers = new Set([...onCampus, ...offCampus].map((c) => c.driverId))
  for (const d of drivers) {
    if (placedDrivers.has(d.id)) continue
    const car: Car = { id: `${prefix}:${d.id}`, driverId: d.id, capacity: d.seats, passengerIds: [] }
    ;(matchKeyword(matchText[d.id] ?? '', keywords) ? onCampus : offCampus).push(car)
  }
  const diy = dir.diy.filter((p) => riderIds.has(p) && !seen.has(p) && seen.add(p))
  return { onCampus, offCampus, diy }
}

export type PlaceTarget = { kind: 'car'; carId: string } | { kind: 'diy' }

/** Seat a rider (car cell or DIY) in one direction — removed from anywhere else
 * in the SAME direction first. The single code path for drop and autocomplete. */
export function placeInDirSet(dir: DirSet, target: PlaceTarget, riderId: string): { dir: DirSet; error?: 'full' } {
  const cleared = removeFromDirSet(dir, riderId)
  if (target.kind === 'diy') return { dir: { ...cleared, diy: [...cleared.diy, riderId] } }
  let full = false
  const seat = (cars: Car[]): Car[] =>
    cars.map((c) => {
      if (c.id !== target.carId) return c
      if (c.driverId === riderId || c.passengerIds.length >= c.capacity - 1) { full = true; return c }
      return { ...c, passengerIds: [...c.passengerIds, riderId] }
    })
  const next = { ...cleared, onCampus: seat(cleared.onCampus), offCampus: seat(cleared.offCampus) }
  return full ? { dir, error: 'full' } : { dir: next }
}

export function removeFromDirSet(dir: DirSet, riderId: string): DirSet {
  const strip = (cars: Car[]) => cars.map((c) => (c.passengerIds.includes(riderId) ? { ...c, passengerIds: c.passengerIds.filter((p) => p !== riderId) } : c))
  return { onCampus: strip(dir.onCampus), offCampus: strip(dir.offCampus), diy: dir.diy.filter((p) => p !== riderId) }
}

/** Type/drop someone into an empty Driver cell: unseat them in this direction,
 * then add their (empty) car to the chosen band. No-op if they already drive here. */
export function addDriverToDirSet(dir: DirSet, band: 'onCampus' | 'offCampus', riderId: string, capacity: number, prefix: DirPrefix): DirSet {
  if ([...dir.onCampus, ...dir.offCampus].some((c) => c.driverId === riderId)) return dir
  const cleared = removeFromDirSet(dir, riderId)
  const car: Car = { id: `${prefix}:${riderId}`, driverId: riderId, capacity: Math.max(2, capacity), passengerIds: [] }
  return { ...cleared, [band]: [...cleared[band], car] }
}

/** Delete a car column; its passengers simply become unplaced. */
export function removeCarFromDirSet(dir: DirSet, carId: string): DirSet {
  return { ...dir, onCampus: dir.onCampus.filter((c) => c.id !== carId), offCampus: dir.offCampus.filter((c) => c.id !== carId) }
}

/** Copy Going → Back (deep copy, ids re-keyed g:→b:). */
export function mirrorDirSet(going: DirSet): DirSet {
  const rekey = (cars: Car[]) => cars.map((c) => ({ ...c, id: `b:${c.driverId}`, passengerIds: [...c.passengerIds] }))
  return { onCampus: rekey(going.onCampus), offCampus: rekey(going.offCampus), diy: [...going.diy] }
}

/** TOTAL panel: needs-ride people bucketed under their campus keyword (list order),
 * everyone unmatched under off-campus. */
export function groupNeedsRide(needsRide: string[], matchText: MatchText, keywords: string[]): { onCampus: { keyword: string; ids: string[] }[]; offCampus: string[] } {
  const byKeyword = new Map<string, string[]>()
  const offCampus: string[] = []
  for (const id of needsRide) {
    const k = matchKeyword(matchText[id] ?? '', keywords)
    if (k) byKeyword.set(k, [...(byKeyword.get(k) ?? []), id])
    else offCampus.push(id)
  }
  return { onCampus: keywords.filter((k) => byKeyword.has(k)).map((k) => ({ keyword: k, ids: byKeyword.get(k)! })), offCampus }
}

const placedIn = (dir: DirSet): Set<string> =>
  new Set([...[...dir.onCampus, ...dir.offCampus].flatMap((c) => c.passengerIds), ...dir.diy])

/** Discrepancy tracker rows. Placed = seated in a car or DIY. Drivers are excluded
 * (a driver "has a ride" by definition — flagging them is noise). People placed in
 * both directions are covered and excluded; one direction only → flag the missing
 * side; needs-ride people placed nowhere → flag both. */
export function discrepancies(needsRide: string[], going: DirSet, back: DirSet): { id: string; needGoing: boolean; needBack: boolean }[] {
  const g = placedIn(going)
  const b = placedIn(back)
  const universe = new Set([...g, ...b, ...needsRide])
  const out: { id: string; needGoing: boolean; needBack: boolean }[] = []
  for (const id of universe) {
    const inG = g.has(id), inB = b.has(id)
    if (inG && inB) continue
    if (!inG && !inB && !needsRide.includes(id)) continue
    out.push({ id, needGoing: !inG, needBack: !inB })
  }
  return out
}

/** Everyone a layout claims: drivers, passengers and DIY riders in either direction.
 * Write-in guests (ids starting "x:") belong to the layout alone and are left out —
 * they can't clash with another layout. */
export function layoutMembers(d: CarpoolDataV2): Set<string> {
  const out = new Set<string>()
  for (const dir of [d.going, d.back]) {
    for (const c of [...dir.onCampus, ...dir.offCampus]) {
      out.add(c.driverId)
      for (const p of c.passengerIds) out.add(p)
    }
    for (const id of dir.diy) out.add(id)
  }
  for (const id of out) if (id.startsWith('x:')) out.delete(id)
  return out
}

/** Riders placed in this layout whose current location no longer matches where they
 * were when it was built (data.seatedAt). Riders with no snapshot are never "moved". */
export function movedRiders(d: CarpoolDataV2, current: Record<string, { location: LatLon | null } | undefined>): string[] {
  const at = d.seatedAt ?? {}
  return [...layoutMembers(d)].filter((id) => {
    if (!(id in at)) return false
    const loc = current[id]?.location
    return (loc ? locationKey(loc) : '') !== at[id]
  })
}

/** Snapshot of where every placed rider is now, for data.seatedAt. */
export function seatSnapshot(d: CarpoolDataV2, current: Record<string, { location: LatLon | null } | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of layoutMembers(d)) {
    if (!current[id]) continue
    const loc = current[id]!.location
    out[id] = loc ? locationKey(loc) : ''
  }
  return out
}

/** The layout as tab-separated text for pasting into Google Sheets: per direction, a
 * title row, then one column per car — driver on top, passengers underneath, and the
 * car's comment on one shared row below the passengers (only when some car has one) —
 * with a DIY column last when anyone's getting there themselves. Tabs and newlines
 * inside names are flattened so a name can't break the grid. */
export function carpoolToTsv(d: CarpoolDataV2, nameOf: (id: string) => string): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim()
  const block = (title: string, dir: DirSet): string[][] => {
    const cars = [...dir.onCampus, ...dir.offCampus]
    const cols: string[][] = cars.map((c) => [nameOf(c.driverId), ...c.passengerIds.map(nameOf)])
    if (dir.diy.length) cols.push(['DIY', ...dir.diy.map(nameOf)])
    if (!cols.length) return [[title], ['(no cars)']]
    const height = Math.max(...cols.map((c) => c.length))
    const rows: string[][] = [[title]]
    for (let i = 0; i < height; i++) rows.push(cols.map((c) => c[i] ?? ''))
    // Comments line up on one row under everyone's passengers, like the builder's cells.
    if (cars.some((c) => c.comment?.trim())) rows.push(cols.map((_, i) => cars[i]?.comment ?? ''))
    return rows
  }
  return [...block('GOING', d.going), [], ...block('BACK', d.back)].map((r) => r.map(clean).join('\t')).join('\n')
}
