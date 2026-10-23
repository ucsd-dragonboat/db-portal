// The rides sheet's colour scheme: the Master Sheet's colours by default, and any of
// them overridden per layout (CarpoolDataV2.colors) from the builder's colour picker.
// The builder and "Copy for Sheets" both read the same scheme.

export const SHEET_COLOR_DEFS = {
  banner: { label: 'Banner', value: '#2f2f2f' },
  direction: { label: 'GOING / BACK label', value: '#e80b0b' },
  band: { label: 'GOING campus bars', value: '#ffefbf' },
  bandBack: { label: 'BACK campus bars', value: '#ffeebf' },
  driver: { label: 'Driver cells', value: '#ffc6a9' },
  filler: { label: 'Grey filler', value: '#d9d9d9' },
  diy: { label: 'DIY bars', value: '#d6ccfe' },
  highlight: { label: 'Off-campus rider in an on-campus car', value: '#c9daf8' },
  sep: { label: 'Separators', value: '#666666' },
  total: { label: 'TOTAL header', value: '#76a5af' },
  count: { label: 'TOTAL counts', value: '#d0e0e3' },
  drivers: { label: 'DRIVERS header', value: '#a2dde0' },
  needRide: { label: 'NEED RIDE headers', value: '#ffd966' },
  offCampus: { label: 'OFF CAMPUS header', value: '#cc0000' },
  onCampus: { label: 'ON CAMPUS header', value: '#3c78d8' },
  keyword: { label: 'Location headings', value: '#a2c4c9' },
  question: { label: 'Question panel', value: '#ffff00' },
  teal: { label: 'Teal bar', value: '#46bdc6' },
  notice: { label: 'Error notice', value: '#ff7c3a' },
} as const

export type SheetColorKey = keyof typeof SHEET_COLOR_DEFS
export type SheetColors = Partial<Record<SheetColorKey, string>>

export const DEFAULT_SHEET_COLORS = Object.fromEntries(
  Object.entries(SHEET_COLOR_DEFS).map(([k, d]) => [k, d.value]),
) as Record<SheetColorKey, string>

const HEX = /^#[0-9a-f]{6}$/i

/** Known keys with valid #rrggbb values only (lower-cased); undefined when none. */
export function cleanSheetColors(raw: unknown): SheetColors | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: SheetColors = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k in SHEET_COLOR_DEFS && typeof v === 'string' && HEX.test(v)) out[k as SheetColorKey] = v.toLowerCase()
  }
  return Object.keys(out).length ? out : undefined
}

/** The full scheme for a layout: defaults with its overrides on top. */
export const sheetColors = (colors?: SheetColors): Record<SheetColorKey, string> => ({ ...DEFAULT_SHEET_COLORS, ...colors })

/** Black or white, whichever reads better on `bg` (for labels on dark custom colours). */
export function textOn(bg: string): '#000000' | '#ffffff' {
  const n = parseInt(bg.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff'
}
