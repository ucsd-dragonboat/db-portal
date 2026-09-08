"use client";

import Link from "next/link";
import Icon from "@/components/icon";
import { addMonths, dayKey, firstOfMonth, monthGrid, monthTitle } from "@/lib/calendar-dates";
import type { CalEvent, CalView } from "./calendar-shell";

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export default function MiniMonth({ date, today, tz, view, events }: {
  date: string; today: string; tz: string | undefined; view: CalView; events: CalEvent[];
}) {
  const focusMonth = firstOfMonth(date).slice(0, 7);
  const hasEvent = new Set(events.map((e) => dayKey(e.starts_at, tz)));
  return (
    <div className="rounded-lg border bg-white p-2" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="mb-1 flex items-center justify-between px-1">
        <Link href={`/calendar?view=${view}&date=${addMonths(date, -1)}`} aria-label="Previous month" className="p-1 text-xs" style={{ color: "var(--g-grey-600)" }}><Icon name="left" /></Link>
        <span className="text-sm font-medium">{monthTitle(date)}</span>
        <Link href={`/calendar?view=${view}&date=${addMonths(date, 1)}`} aria-label="Next month" className="p-1 text-xs" style={{ color: "var(--g-grey-600)" }}><Icon name="right" /></Link>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px]" style={{ color: "var(--g-grey-600)" }}>
        {LETTERS.map((l, i) => <div key={i} className="py-0.5">{l}</div>)}
        {monthGrid(date).map((ymd) => {
          const inMonth = ymd.slice(0, 7) === focusMonth;
          const isToday = ymd === today;
          const focused = ymd === date;
          return (
            <Link key={ymd} href={`/calendar?view=${view}&date=${ymd}`}
              className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] hover:bg-slate-100 ${isToday ? "text-white hover:!bg-[var(--g-blue)]" : ""}`}
              style={{
                background: isToday ? "var(--g-blue)" : undefined,
                color: isToday ? "#fff" : inMonth ? "var(--g-grey-900)" : "var(--g-grey-300)",
                outline: focused && !isToday ? "1px solid var(--g-blue)" : undefined,
              }}>
              {Number(ymd.slice(8))}
              {hasEvent.has(ymd) && !isToday && <span className="absolute bottom-0 h-1 w-1 rounded-full" style={{ background: "var(--g-blue)" }} />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
