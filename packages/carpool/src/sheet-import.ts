// Reading a Google Form response sheet ("Timestamp | Name | Will you be attending? |
// Where are you coming from? | …") into carpool guests. Pure — the web app fetches the
// cells and geocodes the off-campus origins.

import type { GuestCol } from './types'

export type SheetColumns = { timestamp: number | null; name: number; attending: number; location: number | null }

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Response-sheet name → the key a re-import recognises it by. */
export const sheetNameKey = (name: string) => norm(name)

/** What an attendance answer means for the carpool. Matched on the words, so the
 * emoji and exact phrasing don't matter. null = not an attendance answer. */
export function parseAttending(text: string): { col: GuestCol | null; offCampus?: boolean } | null {
  const t = norm(text)
  if (!t) return null
  if (/^no\b/.test(t) || /\bnot (coming|attending|going)\b/.test(t)) return { col: null }
  if (/\bmaybe\b/.test(t)) return { col: null }
  if (/\b(drive|get there|go) (by )?myself\b|\bmy own\b|\bown way\b/.test(t)) return { col: 'diy' }
  if (/\bdrive (others|people)\b|\bcan drive\b/.test(t)) return { col: 'drivers' }
  if (/\bneed (a )?ride\b/.test(t)) return /\boff campus\b/.test(t) ? { col: 'offCampus', offCampus: true } : { col: 'onCampus' }
  return null
}

/** Find the columns from the header row; for any header that doesn't say, look at
 * what the cells hold. Returns null when there's no recognisable name or attendance column. */
export function detectColumns(header: string[], rows: string[][]): SheetColumns | null {
  const h = header.map(norm)
  const find = (re: RegExp, skip: (number | null)[] = []) => {
    const i = h.findIndex((x, j) => re.test(x) && !skip.includes(j))
    return i >= 0 ? i : null
  }
  const width = Math.max(header.length, ...rows.map((r) => r.length))
  const score = (col: number, test: (v: string) => boolean) => rows.reduce((n, r) => n + (r[col] && test(r[col]) ? 1 : 0), 0)
  const best = (test: (v: string) => boolean, skip: (number | null)[]) => {
    let at: number | null = null, top = 0
    for (let c = 0; c < width; c++) {
      if (skip.includes(c)) continue
      const s = score(c, test)
      if (s > top) { top = s; at = c }
    }
    return top >= Math.max(1, rows.length / 2) ? at : null
  }
  const timestamp = find(/timestamp/) ?? best((v) => parseTimestamp(v) !== null, [])
  const attending = find(/attend|coming|will you|going|rsvp/, [timestamp]) ?? best((v) => !!parseAttending(v)?.col, [timestamp])
  const name = find(/\bname\b/, [timestamp, attending])
    ?? (timestamp !== null && timestamp + 1 !== attending && timestamp + 1 < width ? timestamp + 1 : null)
    ?? (attending !== null && attending > 0 && attending - 1 !== timestamp ? attending - 1 : null)
  const location = find(/where|location|pick ?up|coming from|live|from/, [timestamp, attending, name])
    ?? (attending !== null && attending + 1 < width ? attending + 1 : null)
  if (name === null || attending === null) return null
  return { timestamp, name, attending, location }
}

/** "11/9/2026 11:55:05" (Google Forms, US locale) or anything Date understands → ms. */
export function parseTimestamp(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime()
  if (!/\d{4}/.test(v)) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

export type SheetRow = { key: string; name: string; col: GuestCol | null; offCampus: boolean; location: string }

/** Every response, one per person: the latest by timestamp (later rows win ties or
 * when there's no timestamp). Rows without a name or a recognisable answer are dropped. */
export function sheetResponses(rows: string[][], cols: SheetColumns): SheetRow[] {
  const by = new Map<string, { at: number; i: number; row: SheetRow }>()
  rows.forEach((r, i) => {
    const name = (r[cols.name] ?? '').trim()
    const key = sheetNameKey(name)
    const a = parseAttending(r[cols.attending] ?? '')
    if (!key || !a) return
    const at = cols.timestamp !== null ? parseTimestamp(r[cols.timestamp] ?? '') ?? -Infinity : -Infinity
    const prev = by.get(key)
    if (prev && (prev.at > at || (prev.at === at && prev.i > i))) return
    by.set(key, { at, i, row: { key, name, col: a.col, offCampus: !!a.offCampus, location: cols.location !== null ? (r[cols.location] ?? '').trim() : '' } })
  })
  return [...by.values()].map((v) => v.row).sort((a, b) => a.name.localeCompare(b.name))
}

/** The roster member a sheet name most likely is, or null when it's unclear:
 * the exact name; else first name + last initial ("Brandon L"); else a one-word name
 * that's exactly one member's first name. Never guesses between two people. */
export function suggestMember(name: string, roster: { id: string; name: string }[]): string | null {
  const n = norm(name)
  if (!n) return null
  const people = roster.map((r) => ({ id: r.id, parts: norm(r.name).split(' ').filter(Boolean) }))
  const only = (xs: { id: string }[]) => (xs.length === 1 ? xs[0].id : null)
  const exact = people.filter((p) => p.parts.join(' ') === n)
  if (exact.length) return only(exact)
  const [first, ...rest] = n.split(' ')
  if (rest.length === 1 && rest[0].length === 1)
    return only(people.filter((p) => p.parts[0] === first && p.parts.length > 1 && p.parts[p.parts.length - 1][0] === rest[0]))
  if (!rest.length) return only(people.filter((p) => p.parts[0] === first))
  return null
}

/** The pickup spot an on-campus answer names ("Campus - Eighth" → "Eighth College"),
 * or null. Matched on the words left after dropping "campus". */
export function matchSpot<S extends { name: string }>(text: string, spots: S[]): S | null {
  const words = norm(text).split(' ').filter((w) => w && w !== 'campus' && w !== 'college')
  if (!words.length) return null
  const want = words.join(' ')
  const hits = spots.filter((s) => {
    const sn = norm(s.name).split(' ').filter((w) => w !== 'campus' && w !== 'college').join(' ')
    return !!sn && (sn === want || ` ${sn} `.includes(` ${want} `) || ` ${want} `.includes(` ${sn} `))
  })
  return hits.length === 1 ? hits[0] : null
}
