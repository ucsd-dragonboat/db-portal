"use client";

import Link from "next/link";
import { fmtTime } from "@/lib/format";
import { dayHeading, dayKey, KIND_COLORS } from "@/lib/calendar-dates";
import { eventLabel, type CalEvent } from "./calendar-shell";

export default function AgendaView({ date, today, tz, events, userId }: {
  date: string; today: string; tz: string | undefined; events: CalEvent[]; userId: string;
}) {
  // Agenda lists everything from the focused date forward (within the fetched window).
  const upcoming = events.filter((e) => dayKey(e.starts_at, tz) >= date);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of upcoming) {
    const k = dayKey(e.starts_at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const days = [...byDay.keys()].sort();

  if (!days.length) return <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>No upcoming events in this window.</p>;
  return (
    <div className="space-y-4">
      {days.map((ymd) => (
        <section key={ymd}>
          <h2 className="mb-1.5 text-sm font-medium" style={{ color: ymd === today ? "var(--g-blue)" : "var(--g-grey-600)" }}>
            {dayHeading(ymd)}{ymd === today && " · Today"}
          </h2>
          <div className="space-y-1.5">
            {byDay.get(ymd)!.map((e) => {
              const c = KIND_COLORS[e.kind];
              const mine = e.rsvps.find((r) => r.user_id === userId)?.status;
              const yes = e.rsvps.filter((r) => r.status === "yes").length;
              return (
                <Link key={e.id} href={`/events/${e.id}`} className="card card-hover flex items-center gap-3 !p-3 text-sm">
                  <span className="h-8 w-1 shrink-0 rounded" style={{ background: c.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{eventLabel(e)}</div>
                    <div className="text-xs" style={{ color: "var(--g-grey-600)" }}>
                      {fmtTime(e.starts_at, tz)}{e.ends_at && ` – ${fmtTime(e.ends_at, tz)}`}{e.location_name && ` · ${e.location_name}`} · <span className="capitalize">{e.kind}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div style={{ color: "var(--g-grey-600)" }}>{yes} going</div>
                    <div className={mine ? "font-medium" : "text-amber-600"}>{mine ? `You: ${mine}` : "RSVP needed"}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
