"use client";

import Link from "next/link";
import Icon from "@/components/icon";
import { fmtTime } from "@/lib/format";
import { dayKey, firstOfMonth, KIND_COLORS, monthGrid } from "@/lib/calendar-dates";
import type { CalEvent } from "./calendar-shell";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MAX_CHIPS = 3;

export default function MonthView({ date, today, tz, events, userId }: {
  date: string; today: string; tz: string | undefined; events: CalEvent[]; userId: string;
}) {
  const focusMonth = firstOfMonth(date).slice(0, 7);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const k = dayKey(e.starts_at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>
        {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(date).map((ymd, i) => {
          const inMonth = ymd.slice(0, 7) === focusMonth;
          const isToday = ymd === today;
          const dayEvents = byDay.get(ymd) ?? [];
          return (
            <div key={ymd} className="min-h-[6.5rem] border-b p-1"
              style={{ borderColor: "var(--g-grey-300)", borderRight: (i + 1) % 7 ? "1px solid var(--g-grey-300)" : undefined, background: inMonth ? "#fff" : "var(--g-grey-50)" }}>
              <div className="flex justify-end">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "text-white" : ""}`}
                  style={isToday ? { background: "var(--g-blue)" } : { color: inMonth ? "var(--g-grey-900)" : "var(--g-grey-300)" }}>
                  {Number(ymd.slice(8))}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, MAX_CHIPS).map((e) => {
                  const c = KIND_COLORS[e.kind];
                  const going = e.rsvps.some((r) => r.user_id === userId && r.status === "yes");
                  return (
                    <Link key={e.id} href={`/events/${e.id}`} title={e.title}
                      className="block truncate rounded px-1 py-0.5 text-[11px] leading-tight"
                      style={{ background: c.soft, borderLeft: `3px solid ${c.color}` }}>
                      {fmtTime(e.starts_at, tz)} {e.title}{going && <span style={{ color: c.color }}> <Icon name="check" /></span>}
                    </Link>
                  );
                })}
                {dayEvents.length > MAX_CHIPS && (
                  <Link href={`/calendar?view=agenda&date=${ymd}`} className="block px-1 text-[11px]" style={{ color: "var(--g-grey-600)" }}>
                    +{dayEvents.length - MAX_CHIPS} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
