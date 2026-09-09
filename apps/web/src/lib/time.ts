/** Lenient time-of-day parsing so people can just type: "8:45am", "845", "8:45 AM", "8am", "20:00", "0845". */
export function parseTimeText(input: string): { h: number; m: number } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a\.?m\.?|p\.?m\.?|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23) return null;
  return { h, m: min };
}

export function formatTime(h: number, m: number): string {
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Combine a yyyy-mm-dd date and typed time into an ISO string in the browser's local timezone. */
export function combineLocal(date: string, time: string): string | null {
  const t = parseTimeText(time);
  if (!date || !t) return null;
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d, t.h, t.m).toISOString();
}

export const shortDate = (date: string) => {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

/** "Saturday 8/22" — the team's day-naming convention. */
export const dayLabel = (date: string) => {
  const [y, mo, d] = date.split("-").map(Number);
  return `${new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "long" })} ${mo}/${d}`;
};
