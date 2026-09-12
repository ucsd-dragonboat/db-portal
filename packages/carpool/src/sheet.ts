// Pure helpers for the Sheets-style rides layout (CarpoolDataV2): legacy-data
// upgrade, per-direction reconciliation against current RSVPs, placement, the
// TOTAL-panel campus grouping, and the discrepancy tracker.

import type { Car, CarpoolDataV2, DirSet } from './types'
import { DEFAULT_CARPOOL_HEADER, DEFAULT_COLLEGE_KEYWORDS } from './types'

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
  (Array.isArray(raw) ? raw.filter(isCar) : []).map((c) => ({
    ...c,
    id: `${prefix}:${c.driverId}`,
    passengerIds: c.passengerIds.filter((p): p is string => typeof p === 'string'),
  }))

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
      going: cleanDir(r.going, 'g'),
      back: cleanDir(r.back, 'b'),
    }
  }
  const legacy = cleanCars(r.cars, 'g')
  return {
    v: 2,
    header: DEFAULT_CARPOOL_HEADER,
    funFactQuestionId: null,
    collegeKeywords: [...DEFAULT_COLLEGE_KEYWORDS],
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
