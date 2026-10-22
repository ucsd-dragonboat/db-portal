import { describe, expect, it } from 'vitest'
import { computeDriverStats, computePairStats, drivesByEvent, type Trip } from './stats'

const trip = (driverId: string, passengerIds: string[], distanceKm = 10, durationMin = 20): Trip => ({
  driverId, passengerIds, distanceKm, durationMin,
})

describe('computeDriverStats', () => {
  it('accumulates times/miles/minutes across trips', () => {
    const stats = computeDriverStats([
      trip('d1', ['p1', 'p2'], 10, 20),
      trip('d1', ['p1'], 5, 10),
      trip('d2', ['p3'], 3, 6),
    ])
    expect(stats.d1).toEqual({ timesDriven: 2, milesDriven: 15, minutesDriven: 30 })
    expect(stats.d2).toEqual({ timesDriven: 1, milesDriven: 3, minutesDriven: 6 })
  })

  it('does not count an empty car as driving people', () => {
    const stats = computeDriverStats([trip('d1', [])])
    expect(stats.d1).toBeUndefined()
  })
})

describe('computePairStats', () => {
  it('counts driver-passenger and passenger-passenger pairs, deduped and order-independent', () => {
    const pairs = computePairStats([trip('d1', ['p1', 'p2'], 10, 20)])
    const byPair = Object.fromEntries(pairs.map((p) => [`${p.a}-${p.b}`, p]))
    expect(Object.keys(byPair).sort()).toEqual(['d1-p1', 'd1-p2', 'p1-p2'])
    expect(byPair['d1-p1']).toEqual({ a: 'd1', b: 'p1', timesTogether: 1, minutesTogether: 20 })
  })

  it('accumulates across multiple trips together', () => {
    const pairs = computePairStats([trip('d1', ['p1'], 10, 20), trip('d1', ['p1'], 5, 15)])
    expect(pairs).toEqual([{ a: 'd1', b: 'p1', timesTogether: 2, minutesTogether: 35 }])
  })

  it('is a no-op for a driver-only trip', () => {
    expect(computePairStats([trip('d1', [])])).toEqual([])
  })
})

describe('drivesByEvent', () => {
  const trips = [
    { eventId: 'e1', driverId: 'a', passengerIds: ['x'], distanceKm: 5, durationMin: 10 },
    { eventId: 'e1', driverId: 'a', passengerIds: ['y'], distanceKm: 5, durationMin: 10 }, // BACK the same day
    { eventId: 'e2', driverId: 'a', passengerIds: ['x', 'y'], distanceKm: 5, durationMin: 10 },
    { eventId: 'e2', driverId: 'a', passengerIds: [], distanceKm: 5, durationMin: 10 },   // empty car
    { eventId: 'e2', driverId: 'b', passengerIds: ['a'], distanceKm: 5, durationMin: 10 },
  ]
  it('counts drives per event, skipping empty cars', () => {
    expect(drivesByEvent(trips)).toEqual({ a: { e1: 2, e2: 1 }, b: { e2: 1 } })
  })
  it('adds up to timesDriven', () => {
    const stats = computeDriverStats(trips)
    for (const [driver, byEvent] of Object.entries(drivesByEvent(trips)))
      expect(Object.values(byEvent).reduce((n, c) => n + c, 0)).toBe(stats[driver].timesDriven)
  })
})
