import { describe, expect, it } from 'vitest'
import { a1, buildRidesGrid, buildRidesSheet, gridToTsv, trackerCell, type RidesPeople, type SheetCell, type SheetGrid } from './rides-sheet'
import { upgradeCarpoolData } from './sheet'
import type { Car, DirSet } from './types'

const car = (driverId: string, passengerIds: string[] = [], extra: Partial<Car> = {}): Car => ({ id: `g:${driverId}`, driverId, capacity: 5, passengerIds, ...extra })
const dir = (partial: Partial<DirSet> = {}): DirSet => ({ onCampus: [], offCampus: [], diy: [], ...partial })
const names: Record<string, string> = { d1: 'Jack (Seventh)', d2: 'Kenneth', p1: 'Logan', p2: 'Justin Zeng', p3: 'Scott', p4: 'Elyssa', p5: 'Jude', b1: 'Brandon' }
const nameOf = (id: string) => names[id] ?? id
const people: RidesPeople = {
  drivers: ['Jack (Seventh)', 'Kenneth'], offCampus: ['Justin Zeng', 'Scott'],
  onCampus: [{ keyword: 'Seventh', names: ['Logan'] }, { keyword: '➰ Petersoon Loop', names: ['Ann', 'Bo'] }], diy: ['Elyssa', 'Jude'],
}
function sample() {
  const d = upgradeCarpoolData({ v: 2, header: 'LEAVE BY 8:15 AM, ISLAND BY 8:45 AM' }, {})
  d.going = dir({ onCampus: [car('d1', ['p1', 'p2'], { comment: '6AM Time Trial' })], offCampus: [car('d2', ['p3', 'p2'])], diy: ['p4', 'p5'] })
  d.back = dir({ onCampus: [car('b1', ['p2'])] })
  return d
}
const funFact = { question: 'SD food recs?', rows: [{ name: 'Anna', text: 'ninja creami' }, { name: 'Bo <b>', text: 'Taco\nstand' }] }
const g = buildRidesGrid(sample(), { nameOf, people, highlight: new Set(['p2']), funFact })

/** The cell at an A1 address. */
const cell = (grid: SheetGrid, ref: string): SheetCell | null | undefined => {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return grid[Number(m[2]) - 1]?.[col]
}
/** Every merged range in A1 notation. */
const merges = (grid: SheetGrid) => grid.flatMap((row, r) => row.flatMap((c, k) =>
  c && ((c.colspan ?? 1) > 1 || (c.rowspan ?? 1) > 1) ? [`${a1(r, k)}:${a1(r + (c.rowspan ?? 1) - 1, k + (c.colspan ?? 1) - 1)}`] : []))

describe('buildRidesGrid: the Master Sheet template, cell for cell', () => {
  it('has exactly the sheet\'s merged cells', () => {
    expect(merges(g).sort()).toEqual([
      'A1:O2', 'P1:P2',                                   // banner, dark separator top
      'B3:J3', 'K3:K66', 'L3:M3', 'P3:P66',               // ON CAMPUS bar, separators, TOTAL
      'A5:A10', 'B10:J10', 'A12:A16', 'B17:J17', 'A18:A22', // GOING grey blocks, OFF CAMPUS + DIY bars
      'A23:J23',                                          // blank row
      'B24:J24', 'A26:A31', 'B31:J31', 'A33:A37', 'B38:J38', 'A39:A43', // BACK
      'A44:J45', 'A46:J47', 'A48:J49',                    // blank, teal, error notice
      'A50:B66', 'C50:H51', 'C52:H64', 'C65:H66', 'I50:J66', // bottom block
    ].sort())
  })
  it('colours and labels match the export', () => {
    expect(cell(g, 'A1')).toMatchObject({ v: 'LEAVE BY 8:15 AM, ISLAND BY 8:45 AM', bg: '#2f2f2f', fg: '#ffffff', size: 18, align: 'center' })
    expect(cell(g, 'P1')).toMatchObject({ bg: '#2f2f2f' })
    expect(cell(g, 'A3')).toMatchObject({ v: 'GOING ➡️', bg: '#e80b0b', fg: '#ffffff' })
    expect(cell(g, 'B3')).toMatchObject({ v: 'ON CAMPUS', bg: '#ffefbf', align: 'center' })
    expect(cell(g, 'A4')).toMatchObject({ v: 'Driver', bg: '#ffc6a9' })
    expect(cell(g, 'B4')).toMatchObject({ v: 'Jack (Seventh)', bg: '#ffc6a9', bold: true })
    expect(cell(g, 'C4')).toEqual({ bg: '#ffc6a9' })
    expect(cell(g, 'A5')).toMatchObject({ bg: '#d9d9d9' })
    expect(cell(g, 'B9')).toMatchObject({ v: '6AM Time Trial', bold: true })
    expect(cell(g, 'B10')).toMatchObject({ v: 'OFF CAMPUS', bg: '#ffefbf' })
    expect(cell(g, 'B11')?.v).toBe('Kenneth')
    expect([cell(g, 'B12')?.v, cell(g, 'B13')?.v]).toEqual(['Scott', 'Justin Zeng'])
    expect(cell(g, 'A17')).toMatchObject({ bg: '#d6ccfe' })
    expect(cell(g, 'B17')).toMatchObject({ v: 'DIY', bg: '#d6ccfe' })
    expect([cell(g, 'B18')?.v, cell(g, 'B19')?.v]).toEqual(['Elyssa', 'Jude'])
    expect(cell(g, 'A24')).toMatchObject({ v: 'BACK ⬅️', bg: '#e80b0b' })
    expect(cell(g, 'B24')).toMatchObject({ v: 'ON CAMPUS', bg: '#ffeebf' })
    expect(cell(g, 'B25')?.v).toBe('Brandon')
    expect(cell(g, 'A46')).toMatchObject({ bg: '#46bdc6' })
    expect(cell(g, 'A48')).toMatchObject({ v: 'IF YOU SEE AN ERROR ("I only have a ride there!") DM BLUM IMMEDIATELY', bg: '#ff7c3a', fg: '#ffffff', size: 14 })
    expect(cell(g, 'A50')).toMatchObject({ bg: '#666666' })
    expect(cell(g, 'C50')).toMatchObject({ v: '.........', bg: '#666666', fg: '#ffffff' })
    expect(cell(g, 'C52')).toMatchObject({ v: '...', bg: '#ffffff', align: 'center' })
    expect(cell(g, 'K3')).toMatchObject({ bg: '#666666' })
  })
  it('highlights an off-campus person only as a passenger in an ON CAMPUS car', () => {
    expect(cell(g, 'B6')).toMatchObject({ v: 'Justin Zeng', bg: '#c9daf8' })  // GOING, on campus
    expect(cell(g, 'B13')).toMatchObject({ v: 'Justin Zeng', bg: '#ffffff' }) // GOING, off-campus car
    expect(cell(g, 'B5')).toMatchObject({ v: 'Logan', bg: '#ffffff' })
    expect(cell(g, 'B26')).toMatchObject({ v: 'Justin Zeng', bg: '#c9daf8' }) // BACK, on campus
  })
  it('counts each direction\'s people in J22 / J43', () => {
    expect(cell(g, 'J22')).toMatchObject({ v: '=COUNTA(B4:J8,B11:J15,B18:J21)', align: 'right' })
    expect(cell(g, 'J43')?.v).toBe('=COUNTA(B25:J29,B32:J36,B39:J42)')
  })
  it('TOTAL panel: rows and formulas like the sheet', () => {
    expect(cell(g, 'L3')).toMatchObject({ v: 'TOTAL', bg: '#76a5af' })
    expect(cell(g, 'O3')?.v).toBe('=L4+M4+N4+O4')
    expect(cell(g, 'L4')?.v).toBe('=COUNTA(L6:L66)')
    expect(cell(g, 'M4')?.v).toBe('=COUNTA(M7:M66)')
    expect(cell(g, 'N4')?.v).toBe('=COUNTA(N8:N8,N10:N66)') // skips N7 SEVENTH and N9 ➰ PETERSOON LOOP
    expect(cell(g, 'O4')?.v).toBe('=COUNTA(O6:O66)')
    expect(cell(g, 'L4')).toMatchObject({ bg: '#d0e0e3', align: 'right' })
    expect([cell(g, 'L5')?.v, cell(g, 'M5')?.v, cell(g, 'N5')?.v, cell(g, 'O5')?.v]).toEqual(['DRIVERS', 'NEED RIDE', 'NEED RIDE', 'DIY'])
    expect(cell(g, 'M6')).toMatchObject({ v: 'OFF CAMPUS', bg: '#cc0000' })
    expect(cell(g, 'N6')).toMatchObject({ v: 'ON CAMPUS', bg: '#3c78d8' })
    expect([cell(g, 'L6')?.v, cell(g, 'L7')?.v, cell(g, 'O6')?.v, cell(g, 'O7')?.v]).toEqual(['Jack (Seventh)', 'Kenneth', 'Elyssa', 'Jude'])
    expect([cell(g, 'M7')?.v, cell(g, 'M8')?.v]).toEqual(['Justin Zeng', 'Scott'])
    expect([7, 8, 9, 10, 11].map((r) => cell(g, `N${r}`)?.v)).toEqual(['SEVENTH', 'Logan', '➰ PETERSOON LOOP', 'Ann', 'Bo'])
    expect(cell(g, 'N7')).toMatchObject({ bg: '#a2c4c9' })
  })
  it('a group with no keyword (write-ins) gets no heading row', () => {
    const g4 = buildRidesGrid(sample(), { nameOf, people: { ...people, onCampus: [{ keyword: 'MUIR', names: ['Ann'] }, { keyword: '', names: ['Guest'] }] } })
    expect([7, 8, 9].map((r) => cell(g4, `N${r}`)?.v)).toEqual(['MUIR', 'Ann', 'Guest'])
    expect(cell(g4, 'N4')?.v).toBe('=COUNTA(N8:N66)')
  })
  it('question panel: Q1 "Name", R1 the question, then name | answer', () => {
    expect(cell(g, 'Q1')).toMatchObject({ v: 'Name', bg: '#ffff00' })
    expect(cell(g, 'R1')).toMatchObject({ v: 'SD food recs?', bg: '#ffff00' })
    expect([cell(g, 'Q2')?.v, cell(g, 'R2')?.v, cell(g, 'Q3')?.v]).toEqual(['Anna', 'ninja creami', 'Bo <b>'])
    expect(cell(g, 'R2')?.colspan).toBeUndefined()
  })
  it('discrepancy tracker at A67 over the exact name cells', () => {
    expect(trackerCell(g)).toBe('A67')
    const q = cell(g, 'A67')!.v!
    expect(q.slice(q.indexOf('{') + 1, q.indexOf('}')).split(';')).toEqual([
      'FLATTEN(B4:J8)', 'FLATTEN(B11:J15)', 'FLATTEN(B18:J21)',
      'FLATTEN(B25:J29)', 'FLATTEN(B32:J36)', 'FLATTEN(B39:J42)',
      'L6:L66', 'M7:M66', 'N8:N8', 'N10:N66', 'O6:O66',
    ])
    expect(q).toContain("group by Col1 label Col1 'Name', count(Col1) 'Count'")
    expect([cell(g, 'C67')?.v, cell(g, 'C68')?.v, cell(g, 'E67')?.v, cell(g, 'E68')?.v])
      .toEqual(['Total', '=SUM(B68:B)/3', 'Discrepancy', '=IFERROR(FILTER(A68:A, B68:B<>3), "")'])
    expect(cell(g, 'B67')).toEqual({}) // spill cells blank and unformatted
  })
  it('without a question: no P separator or Q/R panel', () => {
    const g5 = buildRidesGrid(sample(), { nameOf, people })
    expect(g5.every((row) => row.length === 15)).toBe(true)
    expect(merges(g5)).not.toContain('P3:P66')
  })
})

describe('growing the template', () => {
  it('a car with 6 passengers adds rows to its band; everything below and the tracker shift', () => {
    const d = sample()
    d.going.onCampus = [car('d1', ['a', 'b', 'c', 'd', 'e', 'f'])]
    const g2 = buildRidesGrid(d, { nameOf, people })
    expect(merges(g2)).toContain('A5:A12') // 6 passengers + comment + OFF CAMPUS bar
    expect(cell(g2, 'B12')).toMatchObject({ v: 'OFF CAMPUS' })
    expect(cell(g2, 'J24')?.v).toBe('=COUNTA(B4:J10,B13:J17,B20:J23)')
    expect(trackerCell(g2)).toBe('A69')
    expect(cell(g2, 'L4')?.v).toBe('=COUNTA(L6:L68)')
  })
  it('more than 9 cars widens the car grid; TOTAL and the banner move right', () => {
    const d = upgradeCarpoolData({ v: 2 }, {})
    d.going.onCampus = Array.from({ length: 11 }, (_, i) => car(`c${i}`))
    const g3 = buildRidesGrid(d, { nameOf, people })
    expect(merges(g3)).toEqual(expect.arrayContaining(['A1:Q2', 'B3:L3', 'M3:M66', 'N3:O3']))
    expect(cell(g3, 'L4')?.v).toBe('c10')
    expect(cell(g3, 'Q3')?.v).toBe('=N4+O4+P4+Q4')
  })
  it('a long DIY list adds DIY rows', () => {
    const d = upgradeCarpoolData({ v: 2 }, {})
    d.going.diy = Array.from({ length: 40 }, (_, i) => `x${i}`)
    const g6 = buildRidesGrid(d, { nameOf, people })
    expect([cell(g6, 'B18')?.v, cell(g6, 'B22')?.v, cell(g6, 'C18')?.v]).toEqual(['x0', 'x4', 'x5']) // 5 rows per column
    expect(merges(g6)).toContain('A18:A23')
    expect(trackerCell(g6)).toBe('A68')
  })
  it('a TOTAL list longer than the template stretches the bottom block', () => {
    const g7 = buildRidesGrid(sample(), { nameOf, people: { ...people, drivers: Array.from({ length: 70 }, (_, i) => `D${i}`) } })
    expect(cell(g7, 'L75')?.v).toBe('D69')
    expect(merges(g7)).toEqual(expect.arrayContaining(['A50:B75', 'K3:K75', 'C65:H66'.replace('65', '74').replace('66', '75')]))
    expect(trackerCell(g7)).toBe('A76')
  })
  it('a1 handles columns past Z', () => {
    expect([a1(0, 0), a1(9, 25), a1(0, 26), a1(2, 27)]).toEqual(['A1', 'Z10', 'AA1', 'AB3'])
  })
})

describe('buildRidesSheet', () => {
  const out = buildRidesSheet(sample(), { nameOf, people, funFact: { question: 'Q', rows: [{ name: 'Bo <b>', text: 'Taco\nstand & "more"' }] } })
  it('renders an HTML table with the merges, escaped', () => {
    expect(out.html).toContain('<td colspan="15" rowspan="2" style="background-color:#2f2f2f;color:#ffffff;text-align:center;font-size:18pt')
    expect(out.html).toContain('<td rowspan="6" style="background-color:#d9d9d9') // A5:A10
    expect(out.html).toContain('<td rowspan="64" style="background-color:#666666') // K3:K66
    expect(out.html).toContain('Bo &lt;b&gt;')
    expect(out.html).toContain('Taco stand &amp; &quot;more&quot;')
    expect(out.html).not.toContain('<b>')
    expect(out.tracker).toBe('A67')
  })
  it('TSV keeps the same positions as the table', () => {
    const rows = out.tsv.split('\n')
    expect(rows[0].split('\t')[0]).toBe('LEAVE BY 8:15 AM, ISLAND BY 8:45 AM')
    expect(rows[0].split('\t').slice(16, 18)).toEqual(['Name', 'Q'])
    expect(rows[3].split('\t').slice(0, 2)).toEqual(['Driver', 'Jack (Seventh)'])
    expect(rows[1].split('\t').slice(16, 18)).toEqual(['Bo <b>', 'Taco stand & "more"'])
    expect(rows[66].startsWith('=QUERY(')).toBe(true)
    expect(gridToTsv([[{ v: 'a\tb' }, null, { v: 'c' }]])).toBe('a b\t\tc')
  })
})

describe('layout colours', () => {
  it('upgradeCarpoolData keeps valid #rrggbb overrides for known keys only', () => {
    const d = upgradeCarpoolData({ v: 2, colors: { band: '#ABCDEF', driver: 'red', nope: '#000000', banner: '#123' } }, {})
    expect(d.colors).toEqual({ band: '#abcdef' })
    expect(upgradeCarpoolData({ v: 2, colors: { driver: 'red' } }, {}).colors).toBeUndefined()
  })
  it("Copy for Sheets uses the layout's colours, with readable text on them", () => {
    const d = sample()
    d.colors = { band: '#1155cc', driver: '#fff2cc', highlight: '#ff00ff', notice: '#000000' }
    const g8 = buildRidesGrid(d, { nameOf, people, highlight: new Set(['p2']) })
    expect(cell(g8, 'B3')).toMatchObject({ v: 'ON CAMPUS', bg: '#1155cc', fg: '#ffffff' }) // dark bar → white text
    expect(cell(g8, 'B4')).toMatchObject({ v: 'Jack (Seventh)', bg: '#fff2cc', fg: '#000000' })
    expect(cell(g8, 'B6')).toMatchObject({ v: 'Justin Zeng', bg: '#ff00ff' })
    expect(cell(g8, 'A48')).toMatchObject({ bg: '#000000', fg: '#ffffff' })
    expect(cell(g8, 'B24')).toMatchObject({ bg: '#ffeebf' }) // untouched colours stay default
    expect(buildRidesSheet(d, { nameOf, people }).html).toContain('background-color:#1155cc;color:#ffffff')
  })
})
