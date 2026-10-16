import { describe, expect, it } from 'vitest'
import { moveCar, spotOf, swapDriver } from './sheet'
import type { Car, DirSet } from './types'

const car = (driverId: string, passengerIds: string[] = [], capacity = 5): Car => ({ id: `g:${driverId}`, driverId, capacity, passengerIds })
const dir = (p: Partial<DirSet> = {}): DirSet => ({ onCampus: [], offCampus: [], diy: [], ...p })
const order = (d: DirSet) => [d.onCampus.map((c) => c.driverId).join(','), d.offCampus.map((c) => c.driverId).join(',')]

describe('moveCar', () => {
  const d = dir({ onCampus: [car('a'), car('b'), car('c')], offCampus: [car('x')] })
  it('moves left, right, to the end, and across bands', () => {
    expect(order(moveCar(d, 'g:c', 'onCampus', 'g:a'))).toEqual(['c,a,b', 'x'])
    expect(order(moveCar(d, 'g:a', 'onCampus', 'g:c'))).toEqual(['b,a,c', 'x'])
    expect(order(moveCar(d, 'g:a', 'onCampus', null))).toEqual(['b,c,a', 'x'])
    expect(order(moveCar(d, 'g:b', 'offCampus', 'g:x'))).toEqual(['a,c', 'b,x'])
    expect(moveCar(d, 'g:a', 'onCampus', 'g:a')).toBe(d)
  })
})

describe('swapDriver', () => {
  const base = () => dir({ onCampus: [car('d1', ['p1', 'p2'], 4)], offCampus: [car('d2', ['p3'])], diy: ['s1'] })
  it('passenger of another car: takes over, old driver gets their seat', () => {
    const r = swapDriver(base(), 'g:d1', 'p3', 'g')!
    expect(r.oldDriverSpot).toBe('passenger')
    expect(r.dir.onCampus[0]).toEqual({ id: 'g:p3', driverId: 'p3', capacity: 4, passengerIds: ['p1', 'p2'] })
    expect(r.dir.offCampus[0].passengerIds).toEqual(['d1'])
  })
  it('passenger of the same car swaps seats with the driver', () => {
    const r = swapDriver(base(), 'g:d1', 'p2', 'g')!
    expect(r.dir.onCampus[0]).toMatchObject({ driverId: 'p2', passengerIds: ['p1', 'd1'] })
  })
  it('DIY, unplaced, and another car\'s driver', () => {
    let r = swapDriver(base(), 'g:d1', 's1', 'g')!
    expect([r.oldDriverSpot, r.dir.diy]).toEqual(['diy', ['d1']])
    r = swapDriver(base(), 'g:d1', 'n1', 'g')!
    expect(r.oldDriverSpot).toBe('none')
    expect(spotOf(r.dir, 'd1')).toEqual({ kind: 'none' })
    r = swapDriver(base(), 'g:d1', 'd2', 'g')!
    expect(r.oldDriverSpot).toBe('driver')
    expect(order(r.dir)).toEqual(['d2', 'd1'])
    expect(r.dir.offCampus[0]).toMatchObject({ id: 'g:d1', passengerIds: ['p3'] })
  })
  it('no-op on its own driver or a missing car', () => {
    expect(swapDriver(base(), 'g:d1', 'd1', 'g')).toBeNull()
    expect(swapDriver(base(), 'g:zz', 'p1', 'g')).toBeNull()
  })
})
