import { fmtDate } from "@/lib/format";

/** Browser-tab title: "Carpool · Fall Regatta · Sat, Oct 17". Empty parts are skipped. */
export function tabTitle(section: string, ...parts: (string | null | undefined)[]): string {
  return [section, ...parts].filter(Boolean).join(" · ");
}

/** A day's event name (its group, else the day's own title) and date, for tab titles. */
export function dayParts(day: { title: string; starts_at: string; group?: unknown } | null): string[] {
  if (!day) return [];
  const group = day.group as { name: string } | null | undefined;
  return [group?.name ?? day.title, fmtDate(day.starts_at)];
}
