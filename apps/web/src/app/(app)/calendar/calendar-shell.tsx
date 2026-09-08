"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Icon from "@/components/icon";
import type { Event, EventKind } from "@/lib/database.types";
import { TEAM_TZ } from "@/lib/format";
import { addDays, addMonths, dayKey, KIND_COLORS, KINDS, monthTitle, startOfWeek } from "@/lib/calendar-dates";
import MonthView from "./month-view";
import WeekView from "./week-view";
import AgendaView from "./agenda-view";
import MiniMonth from "./mini-month";

export type CalEvent = Event & { rsvps: { user_id: string; status: string }[] };
export type CalView = "month" | "week" | "agenda";

const emptySub = () => () => {};
const VIEWS: CalView[] = ["week", "month", "agenda"];

export default function CalendarShell({ events, userId, view, date, today: teamToday }: {
  events: CalEvent[];
  userId: string;
  view: CalView;
  date: string;
  today: string; // today in TEAM_TZ (SSR-stable)
}) {
  // Two-pass timezone (same trick as <LocalTime>): SSR/team tz first, viewer tz after mount.
  const mounted = useSyncExternalStore(emptySub, () => true, () => false);
  const tz = mounted ? undefined : TEAM_TZ;
  const today = mounted ? dayKey(new Date(), tz) : teamToday;

  const [hiddenKinds, setHiddenKinds] = useState<Set<EventKind>>(new Set());
  const visible = useMemo(() => events.filter((e) => !hiddenKinds.has(e.kind)), [events, hiddenKinds]);

  const href = (v: CalView, d: string) => `/calendar?view=${v}&date=${d}`;
  const step = view === "month" ? (n: number) => addMonths(date, n) : view === "week" ? (n: number) => addDays(date, n * 7) : (n: number) => addDays(date, n * 30);
  const title = view === "agenda" ? "Agenda" : view === "week" ? weekTitle(date) : monthTitle(date);

  const toggleKind = (k: EventKind) =>
    setHiddenKinds((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link href={`/calendar?view=${view}`} className="btn-secondary">Today</Link>
          <Link href={href(view, step(-1))} aria-label="Previous" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="left" /></Link>
          <Link href={href(view, step(1))} aria-label="Next" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="right" /></Link>
          <h1 className="text-xl font-normal">{title}</h1>
          <span className="flex-1" />
          <div className="flex rounded-md border text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
            {VIEWS.map((v) => (
              <Link key={v} href={href(v, date)} className="px-4 py-1.5 capitalize first:rounded-l-md last:rounded-r-md"
                style={v === view ? { background: "var(--g-blue-tint)", color: "var(--g-blue)", fontWeight: 500 } : { color: "var(--g-grey-600)" }}>
                {v}
              </Link>
            ))}
          </div>
        </div>
        {view === "month" && <MonthView date={date} today={today} tz={tz} events={visible} userId={userId} />}
        {view === "week" && <WeekView date={date} today={today} tz={tz} events={visible} userId={userId} />}
        {view === "agenda" && <AgendaView date={date} today={today} tz={tz} events={visible} userId={userId} />}
      </div>
      <aside className="hidden w-56 shrink-0 space-y-5 lg:block">
        <MiniMonth date={date} today={today} tz={tz} view={view} events={visible} />
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-grey-600)" }}>Calendars</div>
          <ul className="space-y-1 text-sm">
            {KINDS.map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={!hiddenKinds.has(k)} onChange={() => toggleKind(k)} />
                  <span className="h-3 w-3 rounded-sm" style={{ background: KIND_COLORS[k].color }} />
                  <span className="capitalize">{k}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <Link href="/profile#calendar-feed" className="btn-text -ml-3 text-sm" style={{ color: "var(--g-blue)" }}>
          <Icon name="calendar" /> Calendar feed
        </Link>
      </aside>
    </div>
  );
}

function weekTitle(date: string): string {
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const f = (ymd: string, opts: Intl.DateTimeFormatOptions) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  return `${f(start, { month: "short", day: "numeric" })} – ${f(end, { month: "short", day: "numeric", year: "numeric" })}`;
}
