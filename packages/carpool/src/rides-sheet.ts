// "Copy for Sheets": the rides as a paste-ready copy of the team's Master Sheet ride tab
// ("Saturday Rides"). Google Sheets keeps colours, bold, size, alignment and merged cells
// when it pastes an HTML table, so this builds one cell grid and renders it twice — as
// that table, and as tab-separated text in the same positions for plain-text pastes.
//
// It is the sheet's own template, cell for cell (row numbers below are the defaults):
//   A1:O2 banner · P separator · Q "Name" | R the chosen question, answers from row 2
//   GOING 3–22: ON CAMPUS bar 3, Driver 4, passengers 5–8, comments 9, OFF CAMPUS bar 10,
//     Driver 11, passengers 12–15, comments 16, DIY bar 17, DIY 18–21, headcount J22;
//     grey A5:A10, A12:A16, A18:A22 · blank A23:J23 · BACK 24–43 the same (count J43)
//   A44:J45 blank · A46:J47 teal · A48:J49 the error notice · grey/dots block A50:J66
//   K3:K66 separator · TOTAL L3:O66 (counts in row 4, names from row 6/7) · P3:P66 separator
//   A67 the discrepancy tracker
// A band with more passengers, more than 9 cars or a long DIY list grows the template
// (everything below shifts down / right); every formula follows the cells it describes.

import type { Car, CarpoolDataV2, DirSet } from './types'
import { sheetColors, textOn } from './colors'

export const ERROR_NOTICE = 'IF YOU SEE AN ERROR ("I only have a ride there!") DM BLUM IMMEDIATELY'

/** The TOTAL panel as the builder shows it (names; people moved out of a column left out). */
export type RidesPeople = {
  drivers: string[]
  offCampus: string[]
  /** Keyword groups; keyword "" = no heading row (write-ins). */
  onCampus: { keyword: string; names: string[] }[]
  diy: string[]
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

/** The template's sizes; a layout that needs more grows it. */
const MIN_CAR_COLS = 9
const MIN_PASSENGER_ROWS = 4
const MIN_DIY_ROWS = 4
/** Rows of the grey/dots block at the bottom (A50:J66). */
const BOTTOM_BLOCK_ROWS = 17

/** 0-based row/column → A1 notation (column 26 → "AA"). */
export function a1(row: number, col: number): string {
  let s = ''
  for (let c = col + 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s
  return `${s}${row + 1}`
}

export function buildRidesGrid(d: CarpoolDataV2, { nameOf, people, funFact, highlight = new Set() }: RidesSheetInput): SheetGrid {
  // The layout's colour scheme (the Master Sheet's unless the builder changed some).
  const C = { ...sheetColors(d.colors), white: '#ffffff' }
  const custom = new Set(Object.values(d.colors ?? {}))
  const N = Math.max(MIN_CAR_COLS, ...[d.going, d.back].flatMap((x) => [x.onCampus.length, x.offCampus.length]))
  const SEP = N + 1, T = N + 2, SEP2 = N + 6, Q = N + 7
  const lastCar = N // column of the last car (J by default)
  const grid: SheetGrid = []
  const set = (r: number, c: number, cell: SheetCell) => {
    while (grid.length < r + (cell.rowspan ?? 1)) grid.push([])
    for (let i = 0; i < (cell.rowspan ?? 1); i++) for (let k = 0; k < (cell.colspan ?? 1); k++) grid[r + i][c + k] = null
    grid[r][c] = cell
  }
  const range = (r1: number, c1: number, r2: number, c2: number) => `${a1(r1, c1)}:${a1(r2, c2)}`
  /** Every block of name cells (never headings or comments), for the tracker. */
  const trackerRanges: string[] = []

  // ---- banner A1:O2 ----
  set(0, 0, { v: d.header, bg: C.banner, fg: C.white, size: 18, align: 'center', colspan: T + 4, rowspan: 2 })

  // ---- GOING and BACK ----
  let r = 2
  const section = (dir: DirSet, direction: string, bandBg: string) => {
    const nameBlocks: string[] = []
    /** A campus band's Driver row, passenger rows and comment row; returns the comment row. */
    const cars = (which: 'onCampus' | 'offCampus', bar: number) => {
      const list: Car[] = dir[which]
      const driverRow = bar + 1
      set(driverRow, 0, { v: 'Driver', bg: C.driver })
      for (let i = 0; i < N; i++) set(driverRow, 1 + i, list[i] ? { v: nameOf(list[i].driverId), bg: C.driver, bold: true } : { bg: C.driver })
      const rows = Math.max(MIN_PASSENGER_ROWS, ...list.map((c) => c.passengerIds.length))
      for (let p = 0; p < rows; p++) {
        for (let i = 0; i < N; i++) {
          const id = list[i]?.passengerIds[p]
          set(driverRow + 1 + p, 1 + i, id ? { v: nameOf(id), bg: which === 'onCampus' && highlight.has(id) ? C.highlight : C.white } : { bg: C.white })
        }
      }
      // Car comments ("6AM Time Trial", "LEAVE ASAP") on one row under the passengers.
      const commentRow = driverRow + 1 + rows
      for (let i = 0; i < N; i++) set(commentRow, 1 + i, { v: list[i]?.comment ?? '', bg: C.white, bold: true })
      nameBlocks.push(range(driverRow, 1, commentRow - 1, lastCar))
      return commentRow
    }
    // ON CAMPUS: bar, cars; its grey block runs down through the OFF CAMPUS bar row (A5:A10).
    set(r, 0, { v: direction, bg: C.direction, fg: C.white })
    set(r, 1, { v: 'ON CAMPUS', bg: bandBg, align: 'center', colspan: N })
    const onComment = cars('onCampus', r)
    const offBar = onComment + 1
    set(r + 2, 0, { bg: C.filler, rowspan: offBar - (r + 2) + 1 })
    set(offBar, 1, { v: 'OFF CAMPUS', bg: bandBg, align: 'center', colspan: N })
    // OFF CAMPUS: grey block from its first passenger row through its comment row (A12:A16).
    const offComment = cars('offCampus', offBar)
    set(offBar + 2, 0, { bg: C.filler, rowspan: offComment - (offBar + 2) + 1 })
    // DIY: bar, names flowing down the columns, then the section's headcount (J22).
    const diyBar = offComment + 1
    set(diyBar, 0, { bg: C.diy })
    set(diyBar, 1, { v: 'DIY', bg: C.diy, align: 'center', colspan: N })
    const diyRows = Math.max(MIN_DIY_ROWS, Math.ceil(dir.diy.length / N))
    for (let row = 0; row < diyRows; row++) {
      for (let i = 0; i < N; i++) {
        const id = dir.diy[i * diyRows + row]
        set(diyBar + 1 + row, 1 + i, { v: id ? nameOf(id) : '', bg: C.white })
      }
    }
    nameBlocks.push(range(diyBar + 1, 1, diyBar + diyRows, lastCar))
    const countRow = diyBar + diyRows + 1
    set(diyBar + 1, 0, { bg: C.filler, rowspan: diyRows + 1 })
    for (let i = 0; i < N - 1; i++) set(countRow, 1 + i, { bg: C.white })
    set(countRow, lastCar, { v: `=COUNTA(${nameBlocks.join(',')})`, bg: C.white, align: 'right' })
    trackerRanges.push(...nameBlocks.map((b) => `FLATTEN(${b})`))
    r = countRow + 1
  }
  const goingTop = r
  section(d.going, 'GOING ➡️', C.band)
  set(r, 0, { bg: C.white, colspan: N + 1 }) // A23:J23
  r++
  section(d.back, 'BACK ⬅️', C.bandBack)
  set(r, 0, { bg: C.white, colspan: N + 1, rowspan: 2 }) // A44:J45
  set(r + 2, 0, { bg: C.teal, colspan: N + 1, rowspan: 2 }) // A46:J47
  set(r + 4, 0, { v: ERROR_NOTICE, bg: C.notice, fg: C.white, size: 14, align: 'center', colspan: N + 1, rowspan: 2 }) // A48:J49
  const blockTop = r + 6

  // ---- TOTAL people grid L3:O… ----
  const p = people
  const listTop = goingTop + 3 // row 6: drivers and DIY start here, beside the OFF / ON CAMPUS labels
  const onCampusCol: SheetCell[] = p.onCampus.flatMap((g) => [
    ...(g.keyword ? [{ v: g.keyword.toUpperCase(), bg: C.keyword }] : []), // write-ins have no heading
    ...g.names.map((v) => ({ v, bg: C.white })),
  ])
  const listEnd = Math.max(listTop + p.drivers.length, listTop + 1 + p.offCampus.length, listTop + 1 + onCampusCol.length, listTop + p.diy.length) - 1
  // The grey block runs to row 66, or further when a TOTAL list is longer.
  const bottom = Math.max(blockTop + BOTTOM_BLOCK_ROWS - 1, listEnd)

  set(blockTop, 0, { bg: C.sep, colspan: 2, rowspan: bottom - blockTop + 1 }) // A50:B66
  set(blockTop, 2, { v: '.........', bg: C.sep, fg: C.white, align: 'center', colspan: N - 3, rowspan: 2 }) // C50:H51
  set(blockTop + 2, 2, { v: '...', bg: C.white, align: 'center', colspan: N - 3, rowspan: bottom - blockTop - 3 }) // C52:H64
  set(bottom - 1, 2, { bg: C.sep, colspan: N - 3, rowspan: 2 }) // C65:H66
  set(blockTop, N - 1, { bg: C.sep, colspan: 2, rowspan: bottom - blockTop + 1 }) // I50:J66

  set(goingTop, SEP, { bg: C.sep, rowspan: bottom - goingTop + 1 }) // K3:K66
  const countRow = goingTop + 1
  set(goingTop, T, { v: 'TOTAL', bg: C.total, align: 'center', colspan: 2 })
  set(goingTop, T + 2, { bg: C.total })
  set(goingTop, T + 3, { v: `=${[0, 1, 2, 3].map((k) => a1(countRow, T + k)).join('+')}`, bg: C.total, align: 'center' }) // O3 =L4+M4+N4+O4
  set(countRow + 1, T, { v: 'DRIVERS', bg: C.drivers })
  set(countRow + 1, T + 1, { v: 'NEED RIDE', bg: C.needRide })
  set(countRow + 1, T + 2, { v: 'NEED RIDE', bg: C.needRide })
  set(countRow + 1, T + 3, { v: 'DIY', bg: C.diy })
  set(listTop, T + 1, { v: 'OFF CAMPUS', bg: C.offCampus, fg: C.white })
  set(listTop, T + 2, { v: 'ON CAMPUS', bg: C.onCampus, fg: C.white })
  const lists: { col: number; start: number; cells: SheetCell[] }[] = [
    { col: T, start: listTop, cells: p.drivers.map((v) => ({ v, bg: C.white })) },
    { col: T + 1, start: listTop + 1, cells: p.offCampus.map((v) => ({ v, bg: C.white })) },
    { col: T + 2, start: listTop + 1, cells: onCampusCol },
    { col: T + 3, start: listTop, cells: p.diy.map((v) => ({ v, bg: C.white })) },
  ]
  for (const l of lists) {
    l.cells.forEach((cell, i) => set(l.start + i, l.col, cell))
    // Name cells only: from the list's first row to the bottom, split around headings.
    const runs: string[] = []
    let start = -1
    for (let row = l.start; row <= bottom + 1; row++) {
      const nameCell = row <= bottom && l.cells[row - l.start]?.bg !== C.keyword
      if (nameCell) { if (start < 0) start = row; continue }
      if (start >= 0) runs.push(range(start, l.col, row - 1, l.col))
      start = -1
    }
    set(countRow, l.col, { v: `=COUNTA(${runs.join(',')})`, bg: C.count, align: 'right' }) // L4 =COUNTA(L6:L66) …
    trackerRanges.push(...runs)
  }

  // ---- P separator, then the question: Q "Name" | R the question ----
  if (funFact) {
    set(0, SEP2, { bg: C.banner, rowspan: 2 }) // P1:P2
    set(goingTop, SEP2, { bg: C.sep, rowspan: bottom - goingTop + 1 }) // P3:P66
    set(0, Q, { v: 'Name', bg: C.question })
    set(0, Q + 1, { v: funFact.question, bg: C.question })
    funFact.rows.forEach((row, i) => { set(1 + i, Q, { v: row.name, bg: C.white }); set(1 + i, Q + 1, { v: row.text, bg: C.white }) })
  }

  // ---- A67: the discrepancy tracker ----
  // How often each name appears across the car grids and the TOTAL columns. Everyone
  // should be there 3 times (GOING, BACK, TOTAL); Discrepancy lists anyone who isn't.
  const tr = bottom + 1, first = tr + 2 // header row (0-based), first data row (1-based)
  set(tr, 0, { v: `=QUERY(ARRAYFORMULA(TRIM({${trackerRanges.join(';')}})),"select Col1, count(Col1) where Col1 is not null and Col1 != '' group by Col1 label Col1 'Name', count(Col1) 'Count'",0)`, bold: true })
  set(tr, 2, { v: 'Total', bold: true })
  set(tr + 1, 2, { v: `=SUM(B${first}:B)/3` })
  set(tr, 4, { v: 'Discrepancy', bold: true })
  set(tr + 1, 4, { v: `=IFERROR(FILTER(A${first}:A, B${first}:B<>3), "")` })

  // Blank white inside the template; the tracker's rows (and answers running past them)
  // get unformatted blanks so its formulas can spill.
  const width = funFact ? Q + 2 : T + 4
  for (let row = 0; row < grid.length; row++) {
    for (let c = 0; c < width; c++) {
      if (grid[row][c] === undefined) grid[row][c] = row <= bottom ? { bg: C.white } : {}
      // Text on a custom colour turns black or white, whichever reads.
      const cell = grid[row][c]
      if (cell?.v && cell.bg && custom.has(cell.bg)) cell.fg = textOn(cell.bg)
    }
  }
  return grid
}

/** Where the tracker landed (A67 unless the layout grew the template). */
export function trackerCell(grid: SheetGrid): string {
  return a1(grid.findIndex((row) => row[0]?.v?.startsWith('=QUERY(')), 0)
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

export function buildRidesSheet(d: CarpoolDataV2, input: RidesSheetInput): { html: string; tsv: string; tracker: string } {
  const grid = buildRidesGrid(d, input)
  return { html: gridToHtml(grid), tsv: gridToTsv(grid), tracker: trackerCell(grid) }
}
