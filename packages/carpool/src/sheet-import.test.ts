import { describe, expect, it } from 'vitest'
import { detectColumns, matchSpot, parseAttending, sheetResponses, suggestMember } from './sheet-import'
import { applySheetImport, layoutRiders, linkGuest, setGuestCol } from './guests'
import { upgradeCarpoolData } from './sheet'

// A slice of a real response sheet (no header row, like a copy-paste of the data).
const ROWS = [
  ['11/9/2026 11:55:05', 'Brandon L', 'Yes, and I can drive others 👑', 'California Temple', 'Yes 🥴'],
  ['11/11/2026 14:38:52', 'Kenneth', 'No 🤡', 'Campus - Eighth', 'No 🚱'],
  ['11/8/2026 14:36:54', 'Chinmay', 'Yes, and I need a ride from ON Campus! 🦐', 'Campus - Eighth', 'Yes 🥴'],
  ['11/8/2026 15:00:31', 'Riley Crawford', 'Yes, and I need a ride from ON Campus! 🦐', 'Campus - ERC', 'No 🚱'],
  ['11/11/2026 23:33:31', 'Grace Chen', 'Yes, and I will drive myself (will not drive others) 🫥', 'costa ', 'No 🚱'],
  ['11/11/2026 12:57:03', 'Silas', 'Yes, and I need a ride from OFF campus! 🐉', 'Hippo Home', 'Yes 🥴'],
  ['11/8/2026 23:07:39', 'Big Lao ', 'Yes, and I can drive others 👑', 'Venetian ', 'Yes 🥴'],
  ['11/7/2026 10:00:00', 'Chinmay', 'No 🤡', '', ''], // older answer — the later "yes" wins
]

describe('parseAttending', () => {
  it('reads the answer words, ignoring emoji', () => {
    expect(parseAttending('Yes, and I can drive others 👑')).toEqual({ col: 'drivers' })
    expect(parseAttending('Yes, and I need a ride from ON Campus! 🦐')).toEqual({ col: 'onCampus' })
    expect(parseAttending('Yes, and I need a ride from OFF campus! 🐉')).toEqual({ col: 'offCampus', offCampus: true })
    expect(parseAttending('Yes, and I will drive myself (will not drive others) 🫥')).toEqual({ col: 'diy' })
    expect(parseAttending('No 🤡')).toEqual({ col: null })
    expect(parseAttending('Yes 🥴')).toBeNull() // a drinking answer is not an attendance answer
  })
})

describe('detectColumns', () => {
  it('finds columns from headers', () => {
    expect(detectColumns(['Timestamp', 'Name', 'Will you be attending?', 'Where are you coming from?', 'Drinking?'], ROWS))
      .toEqual({ timestamp: 0, name: 1, attending: 2, location: 3 })
  })
  it('finds them from the cells when the headers say nothing', () => {
    expect(detectColumns(['', '', '', '', ''], ROWS)).toEqual({ timestamp: 0, name: 1, attending: 2, location: 3 })
  })
})

describe('sheetResponses', () => {
  const rows = sheetResponses(ROWS, { timestamp: 0, name: 1, attending: 2, location: 3 })
  it('keeps the latest response per person', () => {
    expect(rows.find((r) => r.name === 'Chinmay')?.col).toBe('onCampus')
    expect(rows.filter((r) => r.key === 'chinmay')).toHaveLength(1)
  })
  it('trims names and locations', () => {
    expect(rows.find((r) => r.key === 'big lao')).toMatchObject({ name: 'Big Lao', col: 'drivers', location: 'Venetian' })
  })
})

describe('suggestMember', () => {
  const roster = [
    { id: 'a', name: 'Brandon Lum' }, { id: 'b', name: 'Brandon Hsu' }, { id: 'c', name: 'Chinmay Patel' },
    { id: 'd', name: 'Riley Crawford' }, { id: 'e', name: 'Kenneth Wu' },
  ]
  it('matches exact names, first + last initial, and unique first names', () => {
    expect(suggestMember('riley crawford', roster)).toBe('d')
    expect(suggestMember('Brandon L', roster)).toBe('a')
    expect(suggestMember('Chinmay', roster)).toBe('c')
  })
  it('never guesses between two people', () => {
    expect(suggestMember('Brandon', roster)).toBeNull()
    expect(suggestMember('Big Lao', roster)).toBeNull()
  })
})

describe('matchSpot', () => {
  const spots = [{ name: 'Eighth College' }, { name: 'ERC' }, { name: 'Pepper Canyon East' }, { name: 'Campus' }]
  it('matches the spot named after "Campus - "', () => {
    expect(matchSpot('Campus - Eighth', spots)?.name).toBe('Eighth College')
    expect(matchSpot('Campus - ERC', spots)?.name).toBe('ERC')
    expect(matchSpot('Pepper Canyon East', spots)?.name).toBe('Pepper Canyon East')
    expect(matchSpot('Stim house', spots)).toBeNull()
  })
})

describe('applySheetImport / linkGuest', () => {
  const form = { drivers: [{ id: 'm1', seats: 4 }], needsRide: ['m2'] }
  const entries = [
    { key: 'big lao', name: 'Big Lao', col: 'drivers' as const, origin: 'Venetian', location: { lat: 1, lon: 2 } },
    { key: 'silas', name: 'Silas', col: 'offCampus' as const, origin: 'Hippo Home', location: null },
  ]
  const base = upgradeCarpoolData({ v: 2 }, {})

  it('adds guests; a guest driver gets a car both ways', () => {
    const r = applySheetImport(base, entries, {})
    expect(r.added).toBe(2)
    const lao = r.data.guests.find((g) => g.name === 'Big Lao')!
    expect([...r.data.going.offCampus, ...r.data.back.offCampus].map((c) => c.driverId)).toEqual([lao.id, lao.id])
    expect(layoutRiders({}, r.data)[lao.id].location).toEqual({ lat: 1, lon: 2 })
  })

  it('a re-import updates instead of duplicating; "No" removes', () => {
    const once = applySheetImport(base, entries, {}).data
    const twice = applySheetImport(once, [{ ...entries[0], col: 'diy' }, { ...entries[1], col: null }], {})
    expect(twice).toMatchObject({ added: 0, updated: 1, removed: 1 })
    expect(twice.data.guests.map((g) => [g.name, g.col])).toEqual([['Big Lao', 'diy']])
    expect(twice.data.going.offCampus).toEqual([])
  })

  it('linking swaps the member in and a re-import then leaves them alone', () => {
    const d = applySheetImport(base, entries, {}).data
    const silas = d.guests.find((g) => g.name === 'Silas')!
    const lao = d.guests.find((g) => g.name === 'Big Lao')!
    const seated = { ...d, going: { ...d.going, offCampus: d.going.offCampus.map((c) => ({ ...c, passengerIds: [silas.id] })) } }
    const linked = linkGuest(linkGuest(seated, silas.id, 'm2', form), lao.id, 'm1', form)
    expect(linked.guests).toEqual([])
    expect(linked.going.offCampus[0]).toMatchObject({ id: 'g:m1', driverId: 'm1', passengerIds: ['m2'] })
    expect(linked.origins).toBeUndefined()
    expect(applySheetImport(linked, entries, {})).toMatchObject({ added: 0, linked: 2 })
  })

  it('a member already placed keeps their spot; the guest just goes', () => {
    const d = applySheetImport(base, [entries[1]], {}).data
    const silas = d.guests[0]
    const placed = { ...d, going: { ...d.going, diy: ['m2', silas.id] } }
    expect(linkGuest(placed, silas.id, 'm2', form).going.diy).toEqual(['m2'])
  })

  it('moving a guest out of DRIVERS takes the car away', () => {
    const d = applySheetImport(base, [entries[0]], {}).data
    expect(setGuestCol(d, d.guests[0].id, 'offCampus', {}).going.offCampus).toEqual([])
  })

  it('survives save/load normalization', () => {
    const d = applySheetImport(base, entries, {}).data
    const again = upgradeCarpoolData(JSON.parse(JSON.stringify(d)), {})
    expect(again.origins).toEqual(d.origins)
    expect(again.sheetNames).toEqual(d.sheetNames)
  })
})
