// "Copy for Sheets": the rides as a paste-ready copy of the team's Master Sheet ride tab.
// Google Sheets keeps colours, bold, size, alignment and merged cells when it pastes an
// HTML table, so this builds one cell grid and renders it twice — as that table, and as
// tab-separated text in the same positions for apps that only take plain text.
//
// Left to right: a label column, the car grid (GOING then BACK; ON CAMPUS, OFF CAMPUS
// and DIY bands), a dark separator, the TOTAL people grid, another separator, then the
// chosen form question as Name | Response. Colours are the Master Sheet's own. Below it
// all, the discrepancy tracker as live formulas over this layout's exact name ranges.

import type { Car, CarpoolDataV2, DirSet } from './types'

const C = {
  banner: '#2f2f2f', direction: '#e80b0b', band: '#ffefbf', bandBack: '#ffeebf', driver: '#ffc6a9', filler: '#d9d9d9',
  white: '#ffffff', diy: '#d6ccfe', sep: '#666666', highlight: '#c9daf8',
  total: '#76a5af', count: '#d0e0e3', drivers: '#a2dde0', needRide: '#ffd966', offCampus: '#cc0000', onCampus: '#3c78d8',
  keyword: '#a2c4c9', question: '#ffff00',
} as const

/** The TOTAL panel as the builder shows it (names; people moved out of a column left out). */
export type RidesPeople = {
  drivers: string[]
  offCampus: string[]
  /** Keyword groups; keyword "" = no heading row (write-ins). */
  onCampus: { keyword: string; names: string[] }[]
  diy: string[]
  /** Everyone in this layout's roster (the TOTAL header's number). */
  total: number
}

export type RidesSheetInput = {
  nameOf: (id: string) => string
  people: RidesPeople
  funFact?: { question: string; rows: { name: string; text: string }[] }
  /** Rider ids shown light blue when they're a passenger in an ON CAMPUS car. */
  highlight?: Set<string>
}

export type SheetCell = { v?: string; bg?: string; fg?: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; size?: number; colspan?: number; rowspan?: number }
/** null = covered by a merged cell (to its left or above). */
export type SheetGrid = (SheetCell | null)[][]

/** At least the sheet's B–J width, so an empty band still reads like the template. */
const MIN_CAR_COLS = 9
const MIN_PASSENGER_ROWS = 4
const DIY_ROWS = 5
/** Each answer to the question merges across this many columns (long food recs fit). */
const ANSWER_COLS = 3

/** 0-based row/column → A1 notation (column 26 → "AA"). */
export function a1(row: number, col: number): string {
  let s = ''
  for (let c = col + 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s
  return `${s}${row + 1}`
}

export function buildRidesGrid(d: CarpoolDataV2, { nameOf, people, funFact, highlight = new Set() }: RidesSheetInput): SheetGrid {
  const diyCols = (dir: DirSet) => Math.ceil(dir.diy.length / DIY_ROWS)
  const N = Math.max(MIN_CAR_COLS, ...[d.going, d.back].flatMap((x) => [x.onCampus.length, x.offCampus.length, diyCols(x)]))
  const SEP = N + 1, T = N + 2, SEP2 = N + 6, Q = N + 7
  const grid: SheetGrid = []
  // Every block of name cells (never headings), for the discrepancy tracker's formula.
  const nameRanges: string[] = []
  const set = (r: number, c: number, cell: SheetCell) => {
    while (grid.length < r + (cell.rowspan ?? 1)) grid.push([])
    for (let i = 0; i < (cell.rowspan ?? 1); i++) for (let k = 0; k < (cell.colspan ?? 1); k++) grid[r + i][c + k] = null
    grid[r][c] = cell
  }

  // ---- left: banner (A1 to the end of TOTAL, two rows tall), then GOING and BACK ----
  set(0, 0, { v: d.header, bg: C.banner, fg: C.white, size: 18, align: 'center', colspan: T + 4, rowspan: 2 })
  if (funFact) set(0, SEP2, { bg: C.banner, rowspan: 2 }) // the separator before the question, dark beside the banner
  let r = 2
  const band = (dir: DirSet, which: 'onCampus' | 'offCampus', label: string, direction: string | null, bandBg: string) => {
    const cars: Car[] = dir[which]
    set(r, 0, direction ? { v: direction, bg: C.direction, fg: C.white, bold: true } : { bg: C.white })
    set(r, 1, { v: label, bg: bandBg, align: 'center', colspan: N })
    r++
    set(r, 0, { v: 'Driver', bg: C.driver })
    for (let i = 0; i < N; i++) set(r, 1 + i, cars[i] ? { v: nameOf(cars[i].driverId), bg: C.driver, bold: true } : { bg: C.driver })
    r++
    const rows = Math.max(MIN_PASSENGER_ROWS, ...cars.map((c) => c.passengerIds.length))
    nameRanges.push(`FLATTEN(${a1(r - 1, 1)}:${a1(r - 1 + rows, N)})`) // driver row + passengers, every car column
    set(r, 0, { bg: C.filler, rowspan: rows }) // one tall grey block, like A5:A8
    for (let p = 0; p < rows; p++, r++) {
      for (let i = 0; i < N; i++) {
        const id = cars[i]?.passengerIds[p]
        set(r, 1 + i, id ? { v: nameOf(id), bg: which === 'onCampus' && highlight.has(id) ? C.highlight : C.white } : { bg: C.white })
      }
    }
    // Car comments ("6AM Time Trial", "LEAVE ASAP") on one row under the passengers.
    set(r, 0, { bg: C.filler })
    for (let i = 0; i < N; i++) set(r, 1 + i, { v: cars[i]?.comment ?? '', bg: C.white, bold: true })
    r++
  }
  const diy = (dir: DirSet) => {
    set(r, 0, { bg: C.diy })
    set(r, 1, { v: 'DIY', bg: C.diy, align: 'center', colspan: N })
    r++
    set(r, 0, { bg: C.filler, rowspan: DIY_ROWS })
    nameRanges.push(`FLATTEN(${a1(r, 1)}:${a1(r + DIY_ROWS - 1, N)})`)
    for (let row = 0; row < DIY_ROWS; row++, r++) {
      for (let i = 0; i < N; i++) {
        const id = dir.diy[i * DIY_ROWS + row]
        set(r, 1 + i, { v: id ? nameOf(id) : '', bg: C.white })
      }
    }
  }
  const section = (dir: DirSet, direction: string, bandBg: string) => {
    band(dir, 'onCampus', 'ON CAMPUS', direction, bandBg)
    band(dir, 'offCampus', 'OFF CAMPUS', null, bandBg)
    diy(dir)
  }
  const goingTop = r
  section(d.going, 'GOING ➡️', C.band)
  r++ // blank row between the directions
  section(d.back, 'BACK ⬅️', C.bandBack)
  let height = r

  // ---- TOTAL people grid, to the right of GOING ----
  const p = people
  const onCampusCount = p.onCampus.reduce((n, g) => n + g.names.length, 0)
  let t = goingTop
  set(t, T, { v: 'TOTAL', bg: C.total, align: 'center', bold: true, colspan: 2 })
  set(t, T + 2, { bg: C.total })
  set(t, T + 3, { v: String(p.total), bg: C.total, align: 'center' })
  t++
  ;[p.drivers.length, p.offCampus.length, onCampusCount, p.diy.length].forEach((n, i) => set(t, T + i, { v: String(n), bg: C.count, align: 'right' }))
  t++
  set(t, T, { v: 'DRIVERS', bg: C.drivers, bold: true })
  set(t, T + 1, { v: 'NEED RIDE', bg: C.needRide, bold: true })
  set(t, T + 2, { v: 'NEED RIDE', bg: C.needRide, bold: true })
  set(t, T + 3, { v: 'DIY', bg: C.diy, bold: true })
  t++
  set(t, T, { bg: C.white })
  set(t, T + 1, { v: 'OFF CAMPUS', bg: C.offCampus, fg: C.white, bold: true })
  set(t, T + 2, { v: 'ON CAMPUS', bg: C.onCampus, fg: C.white, bold: true })
  set(t, T + 3, { bg: C.white })
  t++
  // A group with no keyword (write-ins typed into the column) gets no heading row.
  const name = (v: string): SheetCell => ({ v, bg: C.white })
  const onCampusCol: SheetCell[] = p.onCampus.flatMap((g) => [
    ...(g.keyword ? [{ v: g.keyword.toUpperCase(), bg: C.keyword }] : []),
    ...g.names.map(name),
  ])
  const cols: SheetCell[][] = [p.drivers.map(name), p.offCampus.map(name), onCampusCol, p.diy.map(name)]
  const listRows = Math.max(0, ...cols.map((c) => c.length))
  for (let i = 0; i < listRows; i++) cols.forEach((col, k) => set(t + i, T + k, col[i] ?? { bg: C.white }))
  // Each run of names in a column is one range; keyword headings split the ON CAMPUS column.
  cols.forEach((col, k) => {
    let start = -1
    col.forEach((cell, i) => {
      const isName = cell.bg !== C.keyword
      if (isName && start < 0) start = i
      if (start >= 0 && (!isName || i === col.length - 1)) {
        const end = isName ? i : i - 1
        nameRanges.push(`${a1(t + start, T + k)}:${a1(t + end, T + k)}`)
        start = -1
      }
    })
  })
  height = Math.max(height, t + listRows)

  // ---- the form question: Name | Response, to the right of TOTAL ----
  if (funFact) {
    set(0, Q, { v: funFact.question, bg: C.question, bold: true, colspan: 1 + ANSWER_COLS })
    funFact.rows.forEach((row, i) => {
      set(1 + i, Q, { v: row.name, bg: C.white })
      set(1 + i, Q + 1, { v: row.text, bg: C.white, colspan: ANSWER_COLS })
    })
    height = Math.max(height, 1 + funFact.rows.length)
  }

  // ---- discrepancy tracker, below everything ----
  // How often each name appears across the car grids and the TOTAL columns. Everyone
  // should be there 3 times (GOING, BACK, TOTAL); Discrepancy lists anyone who isn't.
  // The ranges are this layout's own, so keyword headings are never counted however
  // many locations or people there are.
  const body = height
  const tr = body + 2, first = tr + 2 // header row (0-based), first data row (1-based)
  set(tr, 0, { v: `=QUERY(ARRAYFORMULA(TRIM({${nameRanges.join(';')}})),"select Col1, count(Col1) where Col1 is not null and Col1 != '' group by Col1 label Col1 'Name', count(Col1) 'Count'",0)`, bold: true })
  set(tr, 2, { v: 'Total', bold: true })
  set(tr + 1, 2, { v: `=SUM(B${first}:B)/3` })
  set(tr, 4, { v: 'Discrepancy', bold: true })
  set(tr + 1, 4, { v: `=IFERROR(FILTER(A${first}:A, B${first}:B<>3), "")` })
  height = tr + 2

  // Dark separators full height (below the banner), and blank white everywhere else.
  const width = funFact ? Q + 1 + ANSWER_COLS : SEP2
  for (let row = 0; row < height; row++) {
    while (grid.length <= row) grid.push([])
    for (let c = 0; c < width; c++) {
      if (grid[row][c] !== undefined) continue
      // Tracker rows get unformatted blanks, so its formulas can spill into them.
      grid[row][c] = row >= body ? {} : (c === SEP || c === SEP2) && row > 0 ? { bg: C.sep } : { bg: C.white }
    }
  }
  return grid
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const flat = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim()

export function gridToHtml(grid: SheetGrid): string {
  const td = (c: SheetCell) => {
    const style = [
      c.bg && `background-color:${c.bg}`, c.fg && `color:${c.fg}`, c.bold && 'font-weight:bold', c.italic && 'font-style:italic',
      c.align && `text-align:${c.align}`, c.size && `font-size:${c.size}pt`, 'border:1px solid #e2e2e2', 'padding:2px 3px', 'white-space:nowrap',
    ].filter(Boolean).join(';')
    return `<td${c.colspan && c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''} style="${style}">${esc(flat(c.v ?? ''))}</td>`
  }
  const rows = grid.map((row) => `<tr>${row.map((c) => (c ? td(c) : '')).join('')}</tr>`)
  return `<meta charset="utf-8"><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:10pt">${rows.join('')}</table>`
}

/** Same positions as the table (a merged cell's covered columns are empty). */
export function gridToTsv(grid: SheetGrid): string {
  return grid.map((row) => row.map((c) => flat(c?.v ?? '')).join('\t').replace(/\t+$/, '')).join('\n')
}

export function buildRidesSheet(d: CarpoolDataV2, input: RidesSheetInput): { html: string; tsv: string } {
  const grid = buildRidesGrid(d, input)
  return { html: gridToHtml(grid), tsv: gridToTsv(grid) }
}
