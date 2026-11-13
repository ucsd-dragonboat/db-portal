// Guests (people typed in or imported from a response sheet, not on the day's roster)
// and per-layout starting points. Everything here lives on the layout (CarpoolDataV2)
// — RSVPs are never edited.

import type { CarpoolDataV2, CarpoolGuest, DirSet, GuestCol, LatLon, Origin, Rider } from './types'
import { addDriverToDirSet, matchKeyword, removeCarFromDirSet, removeFromDirSet, spotOf, type MatchText } from './sheet'
import { DIRS, setRole, type FormRides } from './roles'

export const isGuestId = (id: string) => id.startsWith('x:')
export const newGuestId = () => `x:${Math.random().toString(36).slice(2, 9)}`
export const DEFAULT_GUEST_SEATS = 5

/** The day's roster as this layout sees it: members with this layout's origin
 * overrides applied, plus its guests (located at their origin, if it was found). */
export function layoutRiders(riders: Record<string, Rider>, data: Pick<CarpoolDataV2, 'guests' | 'origins'>): Record<string, Rider> {
  const o = data.origins ?? {}
  const out: Record<string, Rider> = {}
  for (const r of Object.values(riders)) out[r.id] = o[r.id] ? { ...r, location: o[r.id].location } : r
  for (const g of data.guests) out[g.id] = { id: g.id, name: g.name, location: o[g.id]?.location ?? null }
  return out
}

/** Campus-keyword text for guests: their name + origin (members' come from the RSVP). */
export function guestMatchText(data: Pick<CarpoolDataV2, 'guests' | 'origins'>): MatchText {
  return Object.fromEntries(data.guests.map((g) => [g.id, `${g.name} ${data.origins?.[g.id]?.text ?? ''}`]))
}

/** Guests who need a ride (their TOTAL column is a NEED RIDE one). */
export const guestRiders = (data: Pick<CarpoolDataV2, 'guests'>) =>
  data.guests.filter((g) => g.col === 'onCampus' || g.col === 'offCampus').map((g) => g.id)

/** Set (or with null, clear) one person's starting point for this layout. */
export function setOrigin(data: CarpoolDataV2, id: string, origin: Origin | null): CarpoolDataV2 {
  const origins = { ...data.origins }
  if (origin) origins[id] = origin
  else delete origins[id]
  const next: CarpoolDataV2 = { ...data, origins }
  if (!Object.keys(origins).length) delete next.origins
  return next
}

/** Move a guest to another TOTAL column. Into DRIVERS gives them a car in both
 * directions; out of DRIVERS takes it away (its passengers become unplaced); into
 * DIY puts them in both DIY rows. */
export function setGuestCol(data: CarpoolDataV2, id: string, col: GuestCol, matchText: MatchText): CarpoolDataV2 {
  const g = data.guests.find((x) => x.id === id)
  if (!g) return data
  const next = { ...data, guests: data.guests.map((x) => (x.id === id ? { ...x, col } : x)) }
  for (const dir of DIRS) {
    let d = next[dir]
    const spot = spotOf(d, id)
    if (col === 'drivers') {
      if (spot.kind !== 'driver') {
        const band = matchKeyword(matchText[id] ?? '', data.collegeKeywords) ? 'onCampus' : 'offCampus'
        d = addDriverToDirSet(d, band, id, g.seats ?? DEFAULT_GUEST_SEATS, dir === 'going' ? 'g' : 'b')
      }
    } else {
      if (spot.kind === 'driver') d = removeCarFromDirSet(d, spot.carId)
      d = col === 'diy' ? { ...removeFromDirSet(d, id), diy: [...removeFromDirSet(d, id).diy, id] } : { ...d, diy: d.diy.filter((p) => p !== id) }
    }
    next[dir] = d
  }
  return next
}

/** Remove a guest everywhere: TOTAL panel, seats, a car they drove, their origin. */
export function removeGuest(data: CarpoolDataV2, id: string): CarpoolDataV2 {
  const strip = (d: DirSet) => {
    const s = spotOf(d, id)
    return removeFromDirSet(s.kind === 'driver' ? removeCarFromDirSet(d, s.carId) : d, id)
  }
  return setOrigin({ ...data, guests: data.guests.filter((g) => g.id !== id), going: strip(data.going), back: strip(data.back) }, id, null)
}

/** "This guest is really <member>": the member takes the guest's place in each
 * direction (driving their car, in their seat, or in DIY) — unless the member is
 * already placed in that direction, where they stay put and the guest just goes.
 * The guest's origin is dropped (the member has their own); a seat the member wasn't
 * given by the form is recorded as a role change on this layout. */
export function linkGuest(data: CarpoolDataV2, guestId: string, memberId: string, form: FormRides): CarpoolDataV2 {
  if (!data.guests.some((g) => g.id === guestId) || isGuestId(memberId)) return data
  let next: CarpoolDataV2 = data
  for (const dir of DIRS) {
    const d = next[dir]
    const g = spotOf(d, guestId)
    if (g.kind === 'none' || spotOf(d, memberId).kind !== 'none') continue
    const prefix = dir === 'going' ? 'g' : 'b'
    const swap = (ids: string[]) => ids.map((p) => (p === guestId ? memberId : p))
    const cars = (band: 'onCampus' | 'offCampus') => d[band].map((c) => c.driverId === guestId
      ? { ...c, id: `${prefix}:${memberId}`, driverId: memberId }
      : { ...c, passengerIds: swap(c.passengerIds) })
    next = { ...next, [dir]: { onCampus: cars('onCampus'), offCampus: cars('offCampus'), diy: swap(d.diy) } }
    next = setRole(next, dir, memberId, g.kind === 'driver' ? 'driver' : g.kind === 'diy' ? 'diy' : 'rider', form)
  }
  next = removeGuest(next, guestId)
  if (next.sheetNames) next = { ...next, sheetNames: Object.fromEntries(Object.entries(next.sheetNames).map(([k, v]) => [k, v === guestId ? memberId : v])) }
  return next
}

/** One response-sheet row, ready to apply: who, their TOTAL column (null = not
 * coming), where they start from and where that is. */
export type SheetEntry = { key: string; name: string; col: GuestCol | null; origin: string; location: LatLon | null }

/** Apply a response-sheet import to the layout. A name seen before updates its guest
 * (column + origin) — or, if it was linked to a member, is left alone; a new name
 * becomes a guest; a "No" removes its guest. Returns what changed, for the message. */
export function applySheetImport(data: CarpoolDataV2, entries: SheetEntry[], matchText: MatchText): { data: CarpoolDataV2; added: number; updated: number; removed: number; linked: number } {
  let next = data
  const names = { ...data.sheetNames }
  let added = 0, updated = 0, removed = 0, linked = 0
  for (const e of entries) {
    const prev = names[e.key]
    const guest = prev ? next.guests.find((g) => g.id === prev) : undefined
    if (prev && !guest) {
      if (!isGuestId(prev)) { linked++; continue } // linked to a member — their RSVP rules
      delete names[e.key] // guest was deleted by hand: treat as new
    }
    if (e.col === null) {
      if (guest) { next = removeGuest(next, guest.id); delete names[e.key]; removed++ }
      continue
    }
    const origin = e.origin ? { text: e.origin, location: e.location } : null
    if (guest) {
      next = setOrigin(next, guest.id, origin)
      const mt = { ...matchText, [guest.id]: `${e.name} ${e.origin}` }
      if (guest.col !== e.col) next = setGuestCol(next, guest.id, e.col, mt)
      updated++
    } else {
      const g: CarpoolGuest = { id: newGuestId(), name: e.name, col: 'onCampus' }
      next = setOrigin({ ...next, guests: [...next.guests, g] }, g.id, origin)
      next = e.col === 'onCampus' ? next : setGuestCol(next, g.id, e.col, { ...matchText, [g.id]: `${e.name} ${e.origin}` })
      names[e.key] = g.id
      added++
    }
  }
  next = { ...next, sheetNames: names }
  if (!Object.keys(names).length) delete next.sheetNames
  return { data: next, added, updated, removed, linked }
}
