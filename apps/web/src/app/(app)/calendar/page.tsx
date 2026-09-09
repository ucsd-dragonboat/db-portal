import { requireOrg } from "@/lib/session";
import { getOrCreateCalendarToken } from "@/lib/calendar-token";
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

  const { org, userId, isAdmin } = await requireOrg();
  const supabase = await createClient();

  // One window serves all views: the focused month grid (±7d for tz spillover)
  // plus [today−1d, today+90d] so Agenda always has material.
  const monthStart = firstOfMonth(date);
  const monthEnd = addDays(addMonths(date, 1), -1);
  const fetchStart = [addDays(monthStart, -7), addDays(today, -1)].sort()[0];
  const fetchEnd = [addDays(monthEnd, 7), addDays(today, 90)].sort()[1];
  const { data: events } = await supabase
    .from("events")
    .select("id, title, kind, starts_at, ends_at, location_name, rsvps(user_id, status), group:event_groups(name)")
    .eq("org_id", org.id)
    .gte("starts_at", `${fetchStart}T00:00:00Z`)
    .lte("starts_at", `${fetchEnd}T23:59:59Z`)
    .order("starts_at");
  // Slim what reaches the client: my status + a yes-count, not every member's rsvps.
  const calEvents: CalEvent[] = (events ?? []).map((e) => {
    const rs = e.rsvps as { user_id: string; status: string }[];
    return {
      id: e.id, title: e.title, kind: e.kind, starts_at: e.starts_at, ends_at: e.ends_at, location_name: e.location_name,
      group: e.group as { name: string } | null,
      mine: rs.find((r) => r.user_id === userId)?.status ?? null,
      yes: rs.filter((r) => r.status === "yes").length,
    };
  });

  // What each event has attached — RLS scopes visibility (members: published only).
  const ids = (events ?? []).map((e) => e.id);
  const [{ data: fes }, { data: lus }, { data: cps }] = ids.length
    ? await Promise.all([
        supabase.from("form_events").select("event_id").in("event_id", ids),
        supabase.from("lineups").select("event_id").in("event_id", ids),
        supabase.from("carpools").select("event_id").in("event_id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const attach: Record<string, { form: boolean; lineup: boolean; carpool: boolean }> = {};
  for (const id of ids) attach[id] = { form: false, lineup: false, carpool: false };
  for (const r of fes ?? []) if (attach[r.event_id]) attach[r.event_id].form = true;
  for (const r of lus ?? []) if (r.event_id && attach[r.event_id]) attach[r.event_id].lineup = true;
  for (const r of cps ?? []) if (attach[r.event_id]) attach[r.event_id].carpool = true;

  let feedToken: string | null = null;
  try { feedToken = await getOrCreateCalendarToken(userId); } catch { /* migration 0020 not run yet */ }

  return <CalendarShell events={calEvents} attach={attach} isAdmin={isAdmin} view={view} date={date} today={today} feedToken={feedToken} />;
}
