// Pure calendar math on "yyyy-mm-dd" day keys. Bucketing an ISO timestamp into
// a day depends on a timezone (tz = undefined → the browser's); the ymd string
// arithmetic itself is done in UTC so DST can never shift a grid.

import type { EventKind } from "@/lib/database.types";

const keyFmts = new Map<string, Intl.DateTimeFormat>();
const timeFmts = new Map<string, Intl.DateTimeFormat>();

function keyFmt(tz?: string) {
  const k = tz ?? "";
  let f = keyFmts.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    keyFmts.set(k, f);
  }
  return f;
}

/** "2026-09-07" — the day an instant falls on in `tz` (en-CA emits ISO order). */
export function dayKey(iso: string | Date, tz?: string): string {
  return keyFmt(tz).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function todayKey(tz?: string): string {
  return dayKey(new Date(), tz);
}

/** Minutes since midnight (0–1439) of an instant, in `tz`. */
export function minutesOfDay(iso: string, tz?: string): number {
  const k = tz ?? "";
  let f = timeFmts.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    timeFmts.set(k, f);
  }
  const [h, m] = f.format(new Date(iso)).split(":").map(Number);
  return h * 60 + m;
}

const toUtc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** The Sunday on or before `ymd`. */
export function startOfWeek(ymd: string): string {
  return addDays(ymd, -toUtc(ymd).getUTCDay());
}

/** First day of the month `n` months away. */
export function addMonths(ymd: string, n: number): string {
  const d = toUtc(ymd);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

export function firstOfMonth(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

/** 42 day keys (6 weeks) covering the month of `ymd`, starting on a Sunday. */
export function monthGrid(ymd: string): string[] {
  const start = startOfWeek(firstOfMonth(ymd));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthTitle(ymd: string): string {
  return toUtc(ymd).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Sunday, Sep 7" label for a day key (no timezone ambiguity — pure ymd). */
export function dayHeading(ymd: string): string {
  return toUtc(ymd).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

export const KIND_COLORS: Record<EventKind, { color: string; soft: string }> = {
  practice: { color: "var(--g-green)", soft: "var(--g-green-soft)" },
  race: { color: "var(--g-red)", soft: "var(--g-red-soft)" },
  social: { color: "var(--g-yellow)", soft: "var(--g-yellow-soft)" },
  other: { color: "var(--g-grey-600)", soft: "var(--g-grey-100)" },
};

export const KINDS: EventKind[] = ["practice", "race", "social", "other"];
