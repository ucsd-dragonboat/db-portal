import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { TEAM_TZ } from "@/lib/format";
import { addDays, addMonths, dayKey, firstOfMonth } from "@/lib/calendar-dates";
import CalendarShell, { type CalEvent, type CalView } from "./calendar-shell";

/** Canvas-style calendar: Month (default) / Week / Agenda, ?view=&date= driven. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const view: CalView = sp.view === "week" || sp.view === "agenda" ? sp.view : "month";
  const today = dayKey(new Date(), TEAM_TZ);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;

  const { org, userId } = await requireOrg();
  const supabase = await createClient();

  // One window serves all views: the focused month grid (±7d for tz spillover)
  // plus [today−1d, today+90d] so Agenda always has material.
  const monthStart = firstOfMonth(date);
  const monthEnd = addDays(addMonths(date, 1), -1);
  const fetchStart = [addDays(monthStart, -7), addDays(today, -1)].sort()[0];
  const fetchEnd = [addDays(monthEnd, 7), addDays(today, 90)].sort()[1];
  const { data: events } = await supabase
    .from("events")
    .select("*, rsvps(user_id, status)")
    .eq("org_id", org.id)
    .gte("starts_at", `${fetchStart}T00:00:00Z`)
    .lte("starts_at", `${fetchEnd}T23:59:59Z`)
    .order("starts_at");

  return <CalendarShell events={(events ?? []) as CalEvent[]} userId={userId} view={view} date={date} today={today} />;
}
