import { describe, expect, it } from 'vitest'
import { buildRidesGrid, buildRidesSheet, gridToTsv, type RidesPeople, type SheetGrid } from './rides-sheet'
import { upgradeCarpoolData } from './sheet'
import type { Car, DirSet } from './types'

const car = (driverId: string, passengerIds: string[] = [], extra: Partial<Car> = {}): Car => ({ id: `g:${driverId}`, driverId, capacity: 5, passengerIds, ...extra })
const dir = (partial: Partial<DirSet> = {}): DirSet => ({ onCampus: [], offCampus: [], diy: [], ...partial })
const names: Record<string, string> = { d1: 'Jack (Seventh)', d2: 'Kenneth', p1: 'Logan', p2: 'Justin Zeng', p3: 'Scott', p4: 'Elyssa', p5: 'Jude', b1: 'Brandon' }
const nameOf = (id: string) => names[id] ?? id
const people: RidesPeople = {
  drivers: ['Jack (Seventh)', 'Kenneth'], offCampus: ['Justin Zeng', 'Scott'],
  onCampus: [{ keyword: 'Seventh', names: ['Logan'] }, { keyword: '➰ Petersoon Loop', names: ['Ann', 'Bo'] }], diy: ['Elyssa', 'Jude'], total: 9,
}

function sample() {
  const d = upgradeCarpoolData({ v: 2, header: 'LEAVE BY 8:15 AM, ISLAND BY 8:45 AM' }, {})
  d.going = dir({ onCampus: [car('d1', ['p1', 'p2'], { comment: '6AM Time Trial' })], offCampus: [car('d2', ['p3', 'p2'])], diy: ['p4', 'p5'] })
  d.back = dir({ onCampus: [car('b1', ['p2'])] })
  return d
}
const at = (g: SheetGrid, r: number, c: number) => g[r]?.[c] ?? undefined
// Columns: A=0, cars 1–9, separator 10, TOTAL 11–14, separator 15, question name 16, answer 17–19.
// Rows: banner 0–1 (A1:O2) · GOING on campus: band 2, drivers 3, passengers 4–7, comments 8 ·
// off campus: band 9, drivers 10, passengers 11–14, comments 15 · DIY: 16, names 17–21 ·
// blank 22 · BACK on campus band 23, drivers 24, passengers 25–28…
const g = buildRidesGrid(sample(), { nameOf, people, highlight: new Set(['p2']), funFact: { question: 'SD food recs?', rows: [{ name: 'Anna', text: 'ninja creami' }, { name: 'Bo <b>', text: 'Taco\nstand' }] } })

describe('buildRidesGrid', () => {
  it('merges the banner A1:O2 — label, 9 car columns, separator and TOTAL, two rows tall', () => {
    expect(at(g, 0, 0)).toMatchObject({ v: 'LEAVE BY 8:15 AM, ISLAND BY 8:45 AM', bg: '#2f2f2f', fg: '#ffffff', colspan: 15, rowspan: 2 })
    expect(g[0].slice(1, 15).every((c) => c === null) && g[1].slice(0, 15).every((c) => c === null)).toBe(true)
    expect(at(g, 0, 15)).toMatchObject({ bg: '#2f2f2f', rowspan: 2 }) // P1:P2, dark beside the banner
  })
  it('lays out GOING like the sheet: band, Driver row, passengers, comment row', () => {
    expect(at(g, 2, 0)).toMatchObject({ v: 'GOING ➡️', bg: '#e80b0b' })
    expect(at(g, 2, 1)).toMatchObject({ v: 'ON CAMPUS', bg: '#ffefbf', colspan: 9 })
    expect(at(g, 3, 0)).toMatchObject({ v: 'Driver', bg: '#ffc6a9' })
    expect(at(g, 3, 1)).toMatchObject({ v: 'Jack (Seventh)', bg: '#ffc6a9', bold: true })
    expect(at(g, 3, 2)).toMatchObject({ bg: '#ffc6a9' }) // empty driver cells stay peach
    expect([at(g, 4, 1)?.v, at(g, 5, 1)?.v]).toEqual(['Logan', 'Justin Zeng'])
    expect(at(g, 8, 1)).toMatchObject({ v: '6AM Time Trial', bold: true })
    expect(at(g, 9, 1)).toMatchObject({ v: 'OFF CAMPUS' })
    expect(at(g, 10, 1)?.v).toBe('Kenneth')
  })
  it('merges the grey filler under each Driver label into one tall block (like A5:A8)', () => {
    expect(at(g, 4, 0)).toMatchObject({ bg: '#d9d9d9', rowspan: 4 })
    expect([5, 6, 7].every((r) => g[r][0] === null)).toBe(true)
    expect(at(g, 8, 0)).toEqual({ bg: '#d9d9d9' }) // the comment row's grey cell is separate, not merged in
    expect(at(g, 17, 0)).toMatchObject({ bg: '#d9d9d9', rowspan: 5 }) // DIY rows
    const tall = upgradeCarpoolData({ v: 2 }, {})
    tall.going.onCampus = [car('d1', ['a', 'b', 'c', 'd', 'e', 'f'])]
    expect(at(buildRidesGrid(tall, { nameOf, people }), 4, 0)?.rowspan).toBe(6)
  })
  it('highlights an off-campus person only as a passenger in an ON CAMPUS car', () => {
    expect(at(g, 5, 1)).toMatchObject({ v: 'Justin Zeng', bg: '#c9daf8' })  // going, on campus
    expect(at(g, 12, 1)).toMatchObject({ v: 'Justin Zeng', bg: '#ffffff' }) // going, off-campus car
    expect(at(g, 4, 1)).toMatchObject({ v: 'Logan', bg: '#ffffff' })
    expect(at(g, 25, 1)).toMatchObject({ v: 'Justin Zeng', bg: '#c9daf8' }) // back, on campus
  })
  it('puts DIY under its purple header, flowing down 5 rows per column', () => {
    expect(at(g, 16, 1)).toMatchObject({ v: 'DIY', bg: '#d6ccfe', colspan: 9 })
    expect([at(g, 17, 1)?.v, at(g, 18, 1)?.v, at(g, 19, 1)?.v]).toEqual(['Elyssa', 'Jude', ''])
    const many = upgradeCarpoolData({ v: 2 }, {})
    many.going.diy = Array.from({ length: 7 }, (_, i) => `x${i}`)
    const g2 = buildRidesGrid(many, { nameOf, people: { ...people, onCampus: [] } })
    expect([at(g2, 17, 1)?.v, at(g2, 21, 1)?.v, at(g2, 17, 2)?.v, at(g2, 18, 2)?.v]).toEqual(['x0', 'x4', 'x5', 'x6'])
  })
  it('starts BACK after a blank row', () => {
    expect(at(g, 23, 0)).toMatchObject({ v: 'BACK ⬅️' })
    expect(at(g, 23, 1)).toMatchObject({ v: 'ON CAMPUS', bg: '#ffeebf' })
    expect(at(g, 24, 1)?.v).toBe('Brandon')
  })
  it('puts the TOTAL people grid right of the cars, starting at GOING (row 3)', () => {
    expect(at(g, 2, 10)).toMatchObject({ bg: '#666666' })
    expect(at(g, 2, 11)).toMatchObject({ v: 'TOTAL', colspan: 2 })
    expect(at(g, 2, 14)?.v).toBe('9')
    expect([0, 1, 2, 3].map((i) => at(g, 3, 11 + i)?.v)).toEqual(['2', '2', '3', '2'])
    expect([at(g, 4, 11)?.v, at(g, 4, 12)?.v, at(g, 4, 13)?.v, at(g, 4, 14)?.v]).toEqual(['DRIVERS', 'NEED RIDE', 'NEED RIDE', 'DIY'])
    expect(at(g, 5, 12)).toMatchObject({ v: 'OFF CAMPUS', bg: '#cc0000' })
    expect(at(g, 5, 13)).toMatchObject({ v: 'ON CAMPUS', bg: '#3c78d8' })
    expect([6, 7, 8, 9].map((r) => at(g, r, 13)?.v)).toEqual(['SEVENTH', 'Logan', '➰ PETERSOON LOOP', 'Ann'])
    expect(at(g, 6, 13)).toMatchObject({ bg: '#a2c4c9' })
    expect([at(g, 6, 11)?.v, at(g, 7, 11)?.v, at(g, 6, 12)?.v, at(g, 6, 14)?.v]).toEqual(['Jack (Seventh)', 'Kenneth', 'Justin Zeng', 'Elyssa'])
  })
  it('a group with no keyword (write-ins) gets no heading row', () => {
    const g4 = buildRidesGrid(sample(), { nameOf, people: { ...people, onCampus: [{ keyword: 'MUIR', names: ['Ann'] }, { keyword: '', names: ['Guest'] }] } })
    expect([6, 7, 8].map((r) => at(g4, r, 13)?.v)).toEqual(['MUIR', 'Ann', 'Guest'])
  })
  it('puts the question right of TOTAL: header over name + answer, each answer merged across 3 columns', () => {
    expect(at(g, 2, 15)).toMatchObject({ bg: '#666666' })
    expect(at(g, 0, 16)).toMatchObject({ v: 'SD food recs?', bg: '#ffff00', colspan: 4 })
    expect([at(g, 1, 16)?.v, at(g, 1, 17)?.v, at(g, 2, 16)?.v]).toEqual(['Anna', 'ninja creami', 'Bo <b>'])
    expect(at(g, 1, 17)?.colspan).toBe(3)
    expect(g[1][18] === null && g[1][19] === null).toBe(true)
    expect(g.every((row) => row.length === 20)).toBe(true)
  })
  it('without a question: no panel and no trailing separator', () => {
    const g5 = buildRidesGrid(sample(), { nameOf, people })
    expect(g5.every((row) => row.length === 15)).toBe(true)
  })
  it('widens past 9 columns for a band with more cars (banner follows)', () => {
    const d = upgradeCarpoolData({ v: 2 }, {})
    d.going.onCampus = Array.from({ length: 11 }, (_, i) => car(`c${i}`))
    const g3 = buildRidesGrid(d, { nameOf, people })
    expect(at(g3, 0, 0)?.colspan).toBe(17)
    expect(at(g3, 3, 11)?.v).toBe('c10')
  })
})

describe('buildRidesSheet', () => {
  const out = buildRidesSheet(sample(), { nameOf, people, funFact: { question: 'Q', rows: [{ name: 'Bo <b>', text: 'Taco\nstand & "more"' }] } })
  it('renders an HTML table Sheets keeps colours and merges from, escaped', () => {
    expect(out.html).toContain('<td colspan="15" rowspan="2" style="background-color:#2f2f2f;color:#ffffff;text-align:center;font-size:18pt')
    expect(out.html).toContain('<td rowspan="4" style="background-color:#d9d9d9')
    expect(out.html).toContain('<td colspan="3" style="background-color:#ffffff')
    // A row's covered cells emit no <td>: row 2 is fully under the banner except P..T.
    expect(out.html.split('<tr>')[2].match(/<td/g)?.length).toBe(2)
    expect(out.html).toContain('Bo &lt;b&gt;')
    expect(out.html).toContain('Taco stand &amp; &quot;more&quot;')
    expect(out.html).not.toContain('<b>')
  })
  it('TSV keeps the same positions as the table', () => {
    const rows = out.tsv.split('\n')
    expect(rows[0].split('\t')[0]).toBe('LEAVE BY 8:15 AM, ISLAND BY 8:45 AM')
    expect(rows[0].split('\t')[16]).toBe('Q') // banner's merged columns are blank, question lands in column 16
    expect(rows[3].split('\t').slice(0, 2)).toEqual(['Driver', 'Jack (Seventh)'])
    expect(rows[1].split('\t')[16]).toBe('Bo <b>')
    expect(rows[1].split('\t')[17]).toBe('Taco stand & "more"')
    expect(gridToTsv([[{ v: 'a\tb' }, null, { v: 'c' }]])).toBe('a b\t\tc')
  })
})
