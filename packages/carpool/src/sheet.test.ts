import { describe, expect, it } from 'vitest'
import {
  addDriverToDirSet,
  discrepancies,
  groupNeedsRide,
  matchKeyword,
  mirrorDirSet,
  placeInDirSet,
  reconcileDirSet,
  removeCarFromDirSet,
  removeFromDirSet,
  splitByCampus,
  upgradeCarpoolData,
} from './sheet'
import { DEFAULT_CARPOOL_HEADER, DEFAULT_COLLEGE_KEYWORDS, type Car, type DirSet } from './types'

const car = (driverId: string, capacity = 5, passengerIds: string[] = [], prefix = 'g'): Car => ({
  id: `${prefix}:${driverId}`, driverId, capacity, passengerIds,
})
const dir = (partial: Partial<DirSet> = {}): DirSet => ({ onCampus: [], offCampus: [], diy: [], ...partial })

const MATCH = { d1: 'Alice @ Seventh College', d2: 'Bob (off campus)', p1: 'Cara MARSHALL', p2: 'Dan' }

describe('matchKeyword', () => {
  it('is case-insensitive and honors list order', () => {
    expect(matchKeyword('lives at seventh & marshall', ['MARSHALL', 'SEVENTH'])).toBe('MARSHALL')
    expect(matchKeyword('Sixth college', DEFAULT_COLLEGE_KEYWORDS)).toBe('SIXTH')
    expect(matchKeyword('downtown', DEFAULT_COLLEGE_KEYWORDS)).toBeNull()
  })
})

describe('upgradeCarpoolData', () => {
  it('migrates legacy {cars, mode} into going split by campus', () => {
    const up = upgradeCarpoolData({ cars: [{ id: 'd1', driverId: 'd1', capacity: 5, passengerIds: ['p1'] }, { id: 'd2', driverId: 'd2', capacity: 4, passengerIds: [] }], mode: 'pickup' }, MATCH)
    expect(up.v).toBe(2)
    expect(up.header).toBe(DEFAULT_CARPOOL_HEADER)
    expect(up.going.onCampus.map((c) => c.id)).toEqual(['g:d1'])
    expect(up.going.offCampus.map((c) => c.id)).toEqual(['g:d2'])
    expect(up.going.onCampus[0].passengerIds).toEqual(['p1'])
    expect(up.back).toEqual(dir())
    expect(up.collegeKeywords).toEqual(DEFAULT_COLLEGE_KEYWORDS)
  })
  it('keeps valid guests and drops junk ones', () => {
    const up = upgradeCarpoolData({ v: 2, guests: [{ id: 'x:1', name: 'Aunt Amy', col: 'drivers' }, { id: 'x:2', name: 'Bad', col: 'nope' }, 'junk'] }, {})
    expect(up.guests).toEqual([{ id: 'x:1', name: 'Aunt Amy', col: 'drivers' }])
  })
  it('normalizes partial v2 and rejects junk members', () => {
    const up = upgradeCarpoolData({ v: 2, going: { onCampus: [car('d1'), { junk: true }], diy: ['p1', 42] }, collegeKeywords: [] }, MATCH)
    expect(up.going.onCampus).toHaveLength(1)
    expect(up.going.diy).toEqual(['p1'])
    expect(up.going.offCampus).toEqual([])
    expect(up.back).toEqual(dir())
    expect(up.collegeKeywords).toEqual(DEFAULT_COLLEGE_KEYWORDS)
    expect(up.funFactQuestionId).toBeNull()
  })
  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 'x', 7, [], { cars: 'nope' }]) {
      const up = upgradeCarpoolData(raw, {})
      expect(up.v).toBe(2)
      expect(up.going).toEqual(dir())
    }
  })
})

describe('reconcileDirSet', () => {
  const riderIds = new Set(['d1', 'd2', 'p1', 'p2'])
  it('drops stale drivers, adds new ones by keyword, filters passengers', () => {
    const saved = dir({ offCampus: [car('gone', 5, ['p1', 'ghost'])] })
    const out = reconcileDirSet(saved, [{ id: 'd1', seats: 5 }, { id: 'd2', seats: 4 }], riderIds, MATCH, DEFAULT_COLLEGE_KEYWORDS, 'g')
    expect(out.onCampus.map((c) => c.driverId)).toEqual(['d1']) // Seventh match
    expect(out.offCampus.map((c) => c.driverId)).toEqual(['d2'])
    expect(out.onCampus[0].id).toBe('g:d1')
  })
  it('dedupes a rider seated twice (first placement wins) and filters diy', () => {
    const saved = dir({ onCampus: [car('d1', 5, ['p1'])], offCampus: [car('d2', 5, ['p1'])], diy: ['p1', 'p2', 'ghost'] })
    const out = reconcileDirSet(saved, [{ id: 'd1', seats: 5 }, { id: 'd2', seats: 5 }], riderIds, MATCH, DEFAULT_COLLEGE_KEYWORDS, 'b')
    expect(out.onCampus[0].passengerIds).toEqual(['p1'])
    expect(out.offCampus[0].passengerIds).toEqual([])
    expect(out.diy).toEqual(['p2'])
    expect(out.onCampus[0].id).toBe('b:d1')
  })
})

describe('placeInDirSet / removeFromDirSet', () => {
  it('moves a rider between cars within the direction', () => {
    const d = dir({ onCampus: [car('d1', 5, ['p1'])], offCampus: [car('d2', 5)] })
    const { dir: out, error } = placeInDirSet(d, { kind: 'car', carId: 'g:d2' }, 'p1')
    expect(error).toBeUndefined()
    expect(out.onCampus[0].passengerIds).toEqual([])
    expect(out.offCampus[0].passengerIds).toEqual(['p1'])
  })
  it('refuses a full car and leaves state untouched', () => {
    const d = dir({ onCampus: [car('d1', 2, ['p1'])] })
    const { dir: out, error } = placeInDirSet(d, { kind: 'car', carId: 'g:d1' }, 'p2')
    expect(error).toBe('full')
    expect(out).toEqual(d)
  })
  it('refuses seating the driver in their own car', () => {
    const d = dir({ onCampus: [car('d1', 5)] })
    expect(placeInDirSet(d, { kind: 'car', carId: 'g:d1' }, 'd1').error).toBe('full')
  })
  it('diy placement clears any seat first; remove clears everywhere', () => {
    const d = dir({ onCampus: [car('d1', 5, ['p1'])] })
    const { dir: out } = placeInDirSet(d, { kind: 'diy' }, 'p1')
    expect(out.onCampus[0].passengerIds).toEqual([])
    expect(out.diy).toEqual(['p1'])
    expect(removeFromDirSet(out, 'p1').diy).toEqual([])
  })
})

describe('addDriverToDirSet / removeCarFromDirSet', () => {
  it('promotes a seated rider to a driver (unseated first), no-ops if already driving', () => {
    const d = dir({ onCampus: [car('d1', 5, ['p1'])] })
    const out = addDriverToDirSet(d, 'offCampus', 'p1', 4, 'g')
    expect(out.onCampus[0].passengerIds).toEqual([])
    expect(out.offCampus[0]).toMatchObject({ id: 'g:p1', driverId: 'p1', capacity: 4, passengerIds: [] })
    expect(addDriverToDirSet(out, 'onCampus', 'p1', 4, 'g')).toBe(out)
  })
  it('reconcile keeps a typed-in driver who is still a rider', () => {
    const d = dir({ offCampus: [car('p2', 5, ['p1'])] }) // p2 never RSVP'd as a driver
    const out = reconcileDirSet(d, [{ id: 'd1', seats: 5 }], new Set(['d1', 'p1', 'p2']), MATCH, DEFAULT_COLLEGE_KEYWORDS, 'g')
    expect(out.offCampus.map((c) => c.driverId)).toEqual(['p2'])
    expect(out.onCampus.map((c) => c.driverId)).toEqual(['d1'])
  })
  it('removeCar frees its passengers', () => {
    const d = dir({ onCampus: [car('d1', 5, ['p1'])] })
    const out = removeCarFromDirSet(d, 'g:d1')
    expect(out.onCampus).toEqual([])
    expect(out.diy).toEqual([])
  })
})

describe('mirrorDirSet', () => {
  it('deep-copies and re-keys g:→b:', () => {
    const going = dir({ onCampus: [car('d1', 5, ['p1'])], diy: ['p2'] })
    const back = mirrorDirSet(going)
    expect(back.onCampus[0].id).toBe('b:d1')
    expect(back.diy).toEqual(['p2'])
    back.onCampus[0].passengerIds.push('x')
    expect(going.onCampus[0].passengerIds).toEqual(['p1'])
  })
})

describe('groupNeedsRide', () => {
  it('buckets by keyword (list order) with off-campus fallback', () => {
    const out = groupNeedsRide(['d1', 'p1', 'p2'], MATCH, DEFAULT_COLLEGE_KEYWORDS)
    expect(out.onCampus).toEqual([
      { keyword: 'SEVENTH', ids: ['d1'] },
      { keyword: 'MARSHALL', ids: ['p1'] },
    ])
    expect(out.offCampus).toEqual(['p2'])
  })
})

describe('discrepancies', () => {
  const going = dir({ onCampus: [car('d1', 5, ['p1'])], diy: ['p3'] })
  const back = dir({ onCampus: [car('d1', 5, ['p1'], 'b')] })
  it('flags one-direction riders, unplaced needs-ride, excludes covered + drivers', () => {
    const out = discrepancies(['p2'], going, back)
    expect(out).toContainEqual({ id: 'p3', needGoing: false, needBack: true })  // going only
    expect(out).toContainEqual({ id: 'p2', needGoing: true, needBack: true })   // needs ride, nowhere
    expect(out.find((r) => r.id === 'p1')).toBeUndefined()                      // both directions
    expect(out.find((r) => r.id === 'd1')).toBeUndefined()                      // driver
  })
})
