import { describe, expect, it } from 'vitest'
import { driversIn, formChanges, formRole, revertAll, revertChange, ridersIn, roleIn, setRole } from './roles'
import { reconcileDirSet, upgradeCarpoolData } from './sheet'
import type { Car, CarpoolDataV2, DirSet } from './types'

const car = (driverId: string, capacity = 5, passengerIds: string[] = [], prefix = 'g'): Car => ({ id: `${prefix}:${driverId}`, driverId, capacity, passengerIds })
const dir = (p: Partial<DirSet> = {}): DirSet => ({ onCampus: [], offCampus: [], diy: [], ...p })
const form = { drivers: [{ id: 'd1', seats: 5 }, { id: 'd2', seats: 4 }], needsRide: ['p1', 'p2'] }
const KW = ['SEVENTH']
const MATCH = { d1: 'Alice Seventh', d2: 'Bob', p1: 'Cara', p2: 'Dan', s1: 'Eve' }
const base = (): CarpoolDataV2 => ({
  ...upgradeCarpoolData({ v: 2 }, {}),
  going: dir({ onCampus: [car('d1', 5, ['p1'])], offCampus: [car('d2', 4, ['p2'])] }),
  back: dir({ onCampus: [car('d1', 5, ['p1'], 'b')], offCampus: [car('d2', 4, ['p2'], 'b')] }),
})

describe('roles', () => {
  it('reads the form: driver, rider, DIY', () => {
    expect([formRole(form, 'd1'), formRole(form, 'p1'), formRole(form, 's1')]).toEqual(['driver', 'rider', 'diy'])
  })

  it('stores a change per direction and clears it when it matches the form', () => {
    let d = setRole(base(), 'back', 'd2', 'rider', form)
    expect(roleIn(d, 'back', 'd2', form)).toBe('rider')
    expect(roleIn(d, 'going', 'd2', form)).toBe('driver')
    d = setRole(d, 'back', 'd2', 'driver', form)
    expect(d.roles).toBeUndefined()
    expect(setRole(base(), 'going', 'x:abc', 'driver', form).roles).toBeUndefined() // write-ins have no form
  })

  it('a switched driver gets no car back from reconciliation, in that direction only', () => {
    const d = setRole({ ...base(), back: dir({ onCampus: [car('d1', 5, ['p1', 'd2'], 'b')] }) }, 'back', 'd2', 'rider', form)
    const ids = new Set(['d1', 'd2', 'p1', 'p2'])
    const back = reconcileDirSet(d.back, driversIn(d, 'back', form), ids, MATCH, KW, 'b')
    expect([...back.onCampus, ...back.offCampus].map((c) => c.driverId)).toEqual(['d1'])
    expect(back.onCampus[0].passengerIds).toEqual(['p1', 'd2'])
    const going = reconcileDirSet(d.going, driversIn(d, 'going', form), ids, MATCH, KW, 'g')
    expect([...going.onCampus, ...going.offCampus].map((c) => c.driverId).sort()).toEqual(['d1', 'd2'])
    expect(ridersIn(d, 'back', form, ids).sort()).toEqual(['d2', 'p1', 'p2'])
  })

  it('lists role and seat changes against the form', () => {
    let d = setRole(base(), 'back', 'd2', 'rider', form)
    d = setRole(d, 'going', 's1', 'driver', form)
    d = { ...d, going: { ...d.going, onCampus: [car('d1', 4, ['p1'])] } }
    expect(formChanges(d, form)).toEqual([
      { kind: 'role', dir: 'going', id: 's1', from: 'diy', to: 'driver' },
      { kind: 'seats', dir: 'going', id: 'd1', from: 5, to: 4 },
      { kind: 'role', dir: 'back', id: 'd2', from: 'driver', to: 'rider' },
    ])
    expect(formChanges(d, form, new Set(['d1', 'd2']))).toHaveLength(2) // s1 no longer coming
  })

  it('reverting a switched driver unseats them and brings their car back', () => {
    const d = setRole({ ...base(), back: dir({ onCampus: [car('d1', 5, ['p1', 'd2'], 'b')], diy: [] }) }, 'back', 'd2', 'rider', form)
    const r = revertChange(d, formChanges(d, form)[0], form, MATCH, KW)
    expect(r.roles).toBeUndefined()
    expect(r.back.onCampus[0].passengerIds).toEqual(['p1'])
    expect(r.back.offCampus).toEqual([car('d2', 4, [], 'b')])
  })

  it('reverting a new driver removes their car; its passengers become unplaced', () => {
    let d = base()
    d = setRole({ ...d, going: { ...d.going, offCampus: [...d.going.offCampus, car('p2', 3, [])] } }, 'going', 'p2', 'driver', form)
    d = { ...d, going: { ...d.going, offCampus: [car('d2', 4, []), car('p2', 3, ['s1'])] } }
    const r = revertChange(d, formChanges(d, form)[0], form, MATCH, KW)
    expect(r.going.offCampus.map((c) => c.driverId)).toEqual(['d2'])
    expect(r.roles).toBeUndefined()
  })

  it('reverting seats and DIY; revert all clears everything', () => {
    let d = base()
    d = setRole({ ...d, going: { ...d.going, offCampus: [car('d2', 3, [])], diy: ['p2'] } }, 'going', 'p2', 'diy', form)
    const changes = formChanges(d, form)
    expect(changes.map((c) => c.kind)).toEqual(['role', 'seats'])
    const r = revertChange(d, changes[0], form, MATCH, KW)
    expect(r.going.diy).toEqual([])
    expect(revertChange(d, changes[1], form, MATCH, KW).going.offCampus[0].capacity).toBe(4)
    const all = revertAll(d, form, MATCH, KW)
    expect(formChanges(all, form)).toEqual([])
  })

  it('survives a save round-trip and drops junk', () => {
    const d = setRole(base(), 'back', 'd2', 'rider', form)
    expect(upgradeCarpoolData(JSON.parse(JSON.stringify(d)), {}).roles).toEqual({ back: { d2: 'rider' } })
    expect(upgradeCarpoolData({ v: 2, roles: { going: { a: 'pilot' }, back: 5 } }, {}).roles).toBeUndefined()
  })
})
