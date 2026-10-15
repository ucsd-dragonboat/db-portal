// Per-layout changes to how someone rides, compared with their form response. The
// builder never edits RSVPs: switching a driver to a passenger (or seat counts, or
// DIY) is stored on the layout, per direction, and can be reverted to the form.

import type { CarpoolDataV2, DirSet, RideRole } from './types'
import { addDriverToDirSet, matchKeyword, removeCarFromDirSet, removeFromDirSet, type MatchText } from './sheet'

export type Dir = 'going' | 'back'
export const DIRS: Dir[] = ['going', 'back']

/** What the form responses say. seats = capacity including the driver; anyone who is
 * neither a driver nor needs a ride gets there themselves (DIY). */
export type FormRides = { drivers: { id: string; seats: number }[]; needsRide: string[] }

/** One difference between this layout and the form responses. */
export type FormChange =
  | { kind: 'role'; dir: Dir; id: string; from: RideRole; to: RideRole }
  | { kind: 'seats'; dir: Dir; id: string; from: number; to: number }

const prefixOf = (dir: Dir) => (dir === 'going' ? 'g' : 'b')
const isGuest = (id: string) => id.startsWith('x:')

export function formRole(form: FormRides, id: string): RideRole {
  if (form.drivers.some((d) => d.id === id)) return 'driver'
  return form.needsRide.includes(id) ? 'rider' : 'diy'
}

export function roleIn(data: CarpoolDataV2, dir: Dir, id: string, form: FormRides): RideRole {
  return data.roles?.[dir]?.[id] ?? formRole(form, id)
}

/** Records `role` for one direction; a role matching the form clears the change. */
export function setRole(data: CarpoolDataV2, dir: Dir, id: string, role: RideRole, form: FormRides): CarpoolDataV2 {
  if (isGuest(id)) return data
  const map = { ...(data.roles?.[dir] ?? {}) }
  if (role === formRole(form, id)) delete map[id]
  else map[id] = role
  const roles = { ...data.roles, [dir]: map }
  if (!Object.keys(map).length) delete roles[dir]
  const next: CarpoolDataV2 = { ...data, roles }
  if (!Object.keys(roles).length) delete next.roles
  return next
}

/** Form drivers still driving in `dir` — the cars reconciliation may re-add. */
export function driversIn(data: CarpoolDataV2, dir: Dir, form: FormRides): { id: string; seats: number }[] {
  return form.drivers.filter((d) => roleIn(data, dir, d.id, form) === 'driver')
}

/** Of `ids`, the people who need a ride in `dir`. */
export function ridersIn(data: CarpoolDataV2, dir: Dir, form: FormRides, ids: Iterable<string>): string[] {
  return [...ids].filter((id) => roleIn(data, dir, id, form) === 'rider')
}

/** Every difference from the form, Going first. `known` drops people who are no
 * longer coming (their stale changes are simply ignored). */
export function formChanges(data: CarpoolDataV2, form: FormRides, known?: Set<string>): FormChange[] {
  const out: FormChange[] = []
  const seatsBy = new Map(form.drivers.map((d) => [d.id, d.seats]))
  for (const dir of DIRS) {
    for (const [id, to] of Object.entries(data.roles?.[dir] ?? {})) {
      const from = formRole(form, id)
      if (to !== from && (!known || known.has(id))) out.push({ kind: 'role', dir, id, from, to })
    }
    for (const c of [...data[dir].onCampus, ...data[dir].offCampus]) {
      const seats = seatsBy.get(c.driverId)
      if (seats != null && c.capacity !== seats && roleIn(data, dir, c.driverId, form) === 'driver')
        out.push({ kind: 'seats', dir, id: c.driverId, from: seats, to: c.capacity })
    }
  }
  return out
}

/** Undo one change: the person goes back to what their form says in that direction. */
export function revertChange(data: CarpoolDataV2, change: FormChange, form: FormRides, matchText: MatchText, keywords: string[]): CarpoolDataV2 {
  const { dir, id } = change
  const prefix = prefixOf(dir)
  let d: DirSet = data[dir]
  if (change.kind === 'seats') {
    const fix = (cars: DirSet['onCampus']) => cars.map((c) => (c.driverId === id ? { ...c, capacity: change.from } : c))
    return { ...data, [dir]: { ...d, onCampus: fix(d.onCampus), offCampus: fix(d.offCampus) } }
  }
  if (change.to === 'driver') d = removeCarFromDirSet(d, `${prefix}:${id}`) // their passengers become unplaced
  if (change.from === 'driver') {
    const seats = form.drivers.find((x) => x.id === id)?.seats ?? 5
    d = addDriverToDirSet(removeFromDirSet(d, id), matchKeyword(matchText[id] ?? '', keywords) ? 'onCampus' : 'offCampus', id, seats, prefix)
  } else if (change.to !== 'driver') {
    d = removeFromDirSet(d, id) // rider ↔ DIY: unseat; they're placed again the form's way
  }
  return setRole({ ...data, [dir]: d }, dir, id, change.from, form)
}

export function revertAll(data: CarpoolDataV2, form: FormRides, matchText: MatchText, keywords: string[]): CarpoolDataV2 {
  return formChanges(data, form).reduce((acc, c) => revertChange(acc, c, form, matchText, keywords), data)
}
