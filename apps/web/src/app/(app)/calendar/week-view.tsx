"use client";

import Link from "next/link";
import { fmtTime } from "@/lib/format";
import { addDays, dayKey, KIND_COLORS, minutesOfDay, startOfWeek } from "@/lib/calendar-dates";
import type { CalEvent } from "./calendar-shell";

const START_MIN = 6 * 60;   // 6 AM
const END_MIN = 22 * 60;    // 10 PM
const SPAN = END_MIN - START_MIN;
const HOUR_PX = 48;
const BODY_PX = (SPAN / 60) * HOUR_PX;

export default function WeekView({ date, today, tz, events, userId }: {
  date: string; today: string; tz: string | undefined; events: CalEvent[]; userId: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const k = dayKey(e.starts_at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const hourLabel = (min: number) => {
    const h = min / 60;
    return h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  const dayName = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();

  return (
    <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="min-w-[640px]">
        <div className="grid border-b text-center" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)", borderColor: "var(--g-grey-300)" }}>
          <div />
          {days.map((ymd) => (
            <div key={ymd} className="py-1.5 text-[11px] font-medium" style={{ color: "var(--g-grey-600)" }}>
              {dayName(ymd)}{" "}
              <span className={`ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${ymd === today ? "text-white" : ""}`}
                style={ymd === today ? { background: "var(--g-blue)" } : { color: "var(--g-grey-900)" }}>
                {Number(ymd.slice(8))}
              </span>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
          <div className="relative" style={{ height: BODY_PX }}>
            {Array.from({ length: SPAN / 60 }, (_, i) => (
              <div key={i} className="absolute right-1 text-[10px]" style={{ top: i * HOUR_PX - 6, color: "var(--g-grey-600)" }}>
                {i > 0 && hourLabel(START_MIN + i * 60)}
              </div>
            ))}
          </div>
          {days.map((ymd) => (
            <div key={ymd} className="relative border-l" style={{ height: BODY_PX, borderColor: "var(--g-grey-300)" }}>
              {Array.from({ length: SPAN / 60 }, (_, i) => (
                <div key={i} className="absolute w-full border-t" style={{ top: i * HOUR_PX, borderColor: "var(--g-grey-100)" }} />
              ))}
              {(byDay.get(ymd) ?? []).map((e, idx) => {
                const startMin = Math.max(minutesOfDay(e.starts_at, tz), START_MIN);
                const durMin = e.ends_at ? Math.max((new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()) / 60000, 30) : 120;
                const top = ((startMin - START_MIN) / 60) * HOUR_PX;
                const height = Math.max(Math.min((durMin / 60) * HOUR_PX, BODY_PX - top), 24);
                const c = KIND_COLORS[e.kind];
                const going = e.rsvps.some((r) => r.user_id === userId && r.status === "yes");
                return (
                  <Link key={e.id} href={`/events/${e.id}`} title={e.title}
                    className="absolute overflow-hidden rounded px-1 py-0.5 text-[11px] leading-tight"
                    style={{ top, height, left: `${2 + idx * 6}%`, right: "2%", background: c.soft, borderLeft: `3px solid ${c.color}`, zIndex: idx + 1 }}>
                    <div className="font-medium">{fmtTime(e.starts_at, tz)}{going && " ✓"}</div>
                    <div className="truncate">{e.title}</div>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
