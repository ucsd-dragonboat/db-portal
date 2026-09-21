/**
 * Date formatting. Server components run in UTC on Vercel, so server-side formatting uses the
 * team's home timezone (NEXT_PUBLIC_TZ, default America/Los_Angeles) for a sane first paint;
 * <LocalTime> (client) then re-renders in the viewer's own browser timezone.
 */
export const TEAM_TZ = process.env.NEXT_PUBLIC_TZ || "America/Los_Angeles";

const dt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
const d: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const t: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** tz = undefined → browser/local timezone (only meaningful on the client). */
export const fmtDateTime = (iso: string, tz: string | undefined = TEAM_TZ) => new Date(iso).toLocaleString(undefined, { ...dt, timeZone: tz });

/** "2026-09-21 14:30" — sorts chronologically when sorted as text, which is what
 * spreadsheet/table columns do. Still the team timezone, not UTC. (sv-SE is just
 * a locale that happens to format ISO-style.) */
export const fmtSortable = (iso: string, tz: string | undefined = TEAM_TZ) =>
  new Date(iso).toLocaleString("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string, tz: string | undefined = TEAM_TZ) => new Date(iso).toLocaleDateString(undefined, { ...d, timeZone: tz });
export const fmtTime = (iso: string, tz: string | undefined = TEAM_TZ) => new Date(iso).toLocaleTimeString(undefined, { ...t, timeZone: tz });
