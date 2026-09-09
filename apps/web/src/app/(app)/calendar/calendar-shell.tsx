"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Icon, { type IconName } from "@/components/icon";
import type { EventKind } from "@/lib/database.types";
import { TEAM_TZ } from "@/lib/format";
import { addDays, addMonths, dayKey, monthTitle, startOfWeek, ymdLabel } from "@/lib/calendar-dates";
import MonthView from "./month-view";
import WeekView from "./week-view";
import AgendaView from "./agenda-view";
import MiniMonth from "./mini-month";
import FeedDialog from "./feed-dialog";

/** Slim shape serialized to the client — my status + a yes-count instead of every member's rsvps. */
export type CalEvent = {
  id: string; title: string; kind: EventKind; starts_at: string; ends_at: string | null;
  location_name: string | null;
  group: { name: string } | null;
  mine: string | null; // the viewer's rsvp status
  yes: number;         // total "yes" rsvps
};

/** Day rows carry auto-generated titles ("Saturday 9/12"); the real name is the group's. */
export const eventLabel = (e: CalEvent) => e.group?.name ?? e.title;
export type CalView = "month" | "week" | "agenda";
export type Attachment = "form" | "lineup" | "carpool";
export type AttachMap = Record<string, { form: boolean; lineup: boolean; carpool: boolean }>;

/** Per-event attachments: icon + color, used by the month chips and the sidebar filters. */
export const ATTACHMENTS: { key: Attachment; label: string; icon: IconName; color: string }[] = [
  { key: "form", label: "Form", icon: "form", color: "var(--g-purple)" },
  { key: "lineup", label: "Lineup", icon: "boat", color: "var(--g-blue)" },
  { key: "carpool", label: "Carpool", icon: "car", color: "var(--g-red)" },
];

const emptySub = () => () => {};
const VIEWS: CalView[] = ["week", "month", "agenda"];

export default function CalendarShell({ events, attach, isAdmin = false, view, date, today: teamToday, feedToken = null }: {
  events: CalEvent[];
  attach: AttachMap;
  isAdmin?: boolean;
  view: CalView;
  date: string;
  today: string; // today in TEAM_TZ (SSR-stable)
  feedToken?: string | null;
}) {
  // Two-pass timezone (same trick as <LocalTime>): SSR/team tz first, viewer tz after mount.
  const mounted = useSyncExternalStore(emptySub, () => true, () => false);
  const tz = mounted ? undefined : TEAM_TZ;
  const today = mounted ? dayKey(new Date(), tz) : teamToday;

  // Attachment filters: active filters narrow to events that HAVE that attachment.
  const [filters, setFilters] = useState<Set<Attachment>>(new Set());
  const visible = useMemo(
    () => events.filter((e) => [...filters].every((f) => attach[e.id]?.[f])),
    [events, filters, attach],
  );

  const href = (v: CalView, d: string) => `/calendar?view=${v}&date=${d}`;
  const step = view === "month" ? (n: number) => addMonths(date, n) : view === "week" ? (n: number) => addDays(date, n * 7) : (n: number) => addDays(date, n * 30);
  const title = view === "agenda" ? "Agenda" : view === "week" ? weekTitle(date) : monthTitle(date);

  const toggleFilter = (f: Attachment) =>
    setFilters((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
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
        {view === "month" && <MonthView date={date} today={today} tz={tz} events={visible} attach={attach} isAdmin={isAdmin} />}
        {view === "week" && <WeekView date={date} today={today} tz={tz} events={visible} />}
        {view === "agenda" && <AgendaView date={date} today={today} tz={tz} events={visible} />}
      </div>
      <aside className="hidden w-56 shrink-0 space-y-5 lg:block">
        <MiniMonth date={date} today={today} tz={tz} view={view} events={visible} />
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-grey-600)" }}>Filters</div>
          <ul className="space-y-1 text-sm">
            {ATTACHMENTS.map((a) => {
              const active = filters.has(a.key);
              return (
                <li key={a.key}>
                  <button type="button" onClick={() => toggleFilter(a.key)}
                    title={active ? `Showing only events with a ${a.label.toLowerCase()}` : `Show only events with a ${a.label.toLowerCase()}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition"
                    style={active ? { background: "var(--g-blue-tint)" } : undefined}>
                    <span style={{ color: a.color, opacity: active ? 1 : 0.3 }}><Icon name={a.icon} /></span>
                    <span style={{ color: active ? "var(--g-grey-900)" : "var(--g-grey-600)", fontWeight: active ? 500 : 400 }}>{a.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 px-2 text-[11px]" style={{ color: "var(--g-grey-600)" }}>Filled icon = only events that have one.</p>
        </div>
        <FeedDialog token={feedToken} />
      </aside>
    </div>
  );
}

function weekTitle(date: string): string {
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  return `${ymdLabel(start, { month: "short", day: "numeric" })} – ${ymdLabel(end, { month: "short", day: "numeric", year: "numeric" })}`;
}
