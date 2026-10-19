// Minimal RFC 5545 (iCalendar) generation — no dependency needed for one feed.
// Rules that matter: CRLF line endings, lines folded at 75 octets (continuation
// lines start with a space), text values escape \ ; , and newlines.

import { fmtDateTime, TEAM_TZ } from "@/lib/format";
import { birthdayInYear } from "@/lib/birthday";

export type IcsEvent = {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  rsvp_deadline: string | null;
  created_at: string;
};

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r/g, "").replace(/\n/g, "\\n").replace(/[;,]/g, (c) => `\\${c}`);
}

/** Folds one logical line at 75 octets without splitting a UTF-8 character. */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    // continuation lines start with a space, so subsequent chunks fold at 74
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

/** ISO timestamp → RFC 5545 UTC form: 20260907T183000Z */
function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const TWO_HOURS_MS = 2 * 3600e3;

/** A teammate's birthday: "MM-DD" only — the birth year never leaves the portal. */
export type IcsBirthday = { userId: string; name: string; md: string };

/** YYYYMMDD of month-day `md` in `year`, shifted by `plusDays` (Feb 29 → Feb 28 in other years). */
function icsDate(md: string, year: number, plusDays = 0): string {
  const [m, d] = birthdayInYear(md, year).split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, d + plusDays)).toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildIcs({ name, origin, events, birthdays = [], now = new Date() }: { name: string; origin: string; events: IcsEvent[]; birthdays?: IcsBirthday[]; now?: Date }): string {
  const host = new URL(origin).host;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//db-team-portal//calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-TIMEZONE:${TEAM_TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
  ];
  for (const e of events) {
    const end = e.ends_at ?? new Date(new Date(e.starts_at).getTime() + TWO_HOURS_MS).toISOString();
    const url = `${origin}/events/${e.id}`;
    const description = [url, e.rsvp_deadline ? `RSVP by ${fmtDateTime(e.rsvp_deadline, TEAM_TZ)}` : null].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@${host}`,
      // Events have no updated_at; a stable DTSTAMP is fine — subscribers re-read the whole feed.
      `DTSTAMP:${icsUtc(e.created_at)}`,
      `DTSTART:${icsUtc(e.starts_at)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.location_name ? [`LOCATION:${icsEscape(e.location_name)}`] : []),
      `CATEGORIES:${icsEscape(e.kind)}`,
      `URL:${url}`,
      `DESCRIPTION:${icsEscape(description)}`,
      "END:VEVENT",
    );
  }
  // Birthdays: this year's and next year's, like the team Google Calendar sync — all-day
  // and free, so they never block anyone's schedule.
  const year = now.getUTCFullYear();
  const stamp = icsUtc(new Date(Date.UTC(year, 0, 1)).toISOString());
  for (const b of birthdays) {
    for (const y of [year, year + 1]) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:bd-${b.userId}-${y}@${host}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(b.md, y)}`,
        `DTEND;VALUE=DATE:${icsDate(b.md, y, 1)}`,
        `SUMMARY:${icsEscape(`🎂 ${b.name}'s birthday`)}`,
        "CATEGORIES:birthday",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
