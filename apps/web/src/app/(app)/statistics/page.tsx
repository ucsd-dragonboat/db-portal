import { computeDriverStats, computePairStats, drivesByEvent, type Trip } from "@db/carpool";
import Icon from "@/components/icon";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { CarpoolTrip, Membership, Profile } from "@/lib/database.types";
import { PairsView, StatCell } from "./forms";
import DrivesInfo from "./drives-info";

export default async function StatisticsPage() {
  const { org, isAdmin } = await requireOrg();
  const supabase = await createClient();

  // Attendance is counted in Postgres (migration 0027) rather than by pulling every
  // RSVP row down: the old `.in("event_id", <every event id>)` both overflowed the
  // request URL once an org had a few hundred events and shipped one row per RSVP.
  const [{ data: members }, { data: trips }, { data: counts }] = await Promise.all([
    supabase.from("memberships").select("*, profile:profiles(*)").eq("org_id", org.id),
    // Each trip's day and its event's name, for the Times Drove breakdown.
    supabase.from("carpool_trips").select("*, event:events(title, starts_at, group:event_groups(name))").eq("org_id", org.id),
    supabase.rpc("attendance_counts", { org: org.id }),
  ]);
  const roster = ((members ?? []) as (Membership & { profile: Profile })[]).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));

  const attendanceYes: Record<string, number> = {};
  for (const r of counts ?? []) attendanceYes[r.user_id] = Number(r.n);

  const carpoolTrips: Trip[] = ((trips ?? []) as CarpoolTrip[]).map((t) => ({
    driverId: t.driver_id, passengerIds: t.passenger_ids, distanceKm: t.distance_km, durationMin: t.duration_min,
  }));
  const driverStats = computeDriverStats(carpoolTrips);
  const pairStats = computePairStats(carpoolTrips);

  // Times Drove ⓘ: drives per event — an event group's days merge into one line under
  // the group's name ("Time Trials (2)"); a day without a group uses its own title.
  type TripEvent = { title: string; starts_at: string; group: { name: string } | null } | null;
  const eventOf = new Map(((trips ?? []) as (CarpoolTrip & { event: TripEvent })[]).map((t) => [t.event_id, t.event]));
  const perEvent = drivesByEvent(((trips ?? []) as CarpoolTrip[]).map((t) => ({
    eventId: t.event_id, driverId: t.driver_id, passengerIds: t.passenger_ids, distanceKm: t.distance_km, durationMin: t.duration_min,
  })));
  const drivesBreakdown = (userId: string, adjustment: number): { label: string; count: number }[] => {
    const byName = new Map<string, { count: number; latest: string }>();
    for (const [eventId, count] of Object.entries(perEvent[userId] ?? {})) {
      const ev = eventOf.get(eventId);
      const label = ev?.group?.name ?? ev?.title ?? "Deleted event";
      const cur = byName.get(label) ?? { count: 0, latest: "" };
      byName.set(label, { count: cur.count + count, latest: ev?.starts_at && ev.starts_at > cur.latest ? ev.starts_at : cur.latest });
    }
    const items = [...byName.entries()].sort((a, b) => b[1].latest.localeCompare(a[1].latest)).map(([label, v]) => ({ label, count: v.count }));
    return adjustment ? [...items, { label: "Manual adjustment", count: adjustment }] : items;
  };
  const names = Object.fromEntries(roster.map((m) => [m.user_id, m.profile.full_name || m.profile.email]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Statistics</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
          Attendance and driving totals for the whole team. Miles/minutes only count carpools published after this page shipped.{isAdmin && " Type a new total in any cell and Save to correct it — later carpools keep adding to it."}
        </p>
      </div>

      <div className="sheet-wrap">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-green-soft)", color: "var(--g-green)" }}>
          <span className="font-medium"><Icon name="table" /> Roster</span>
        </div>
        <table className="gsheet">
          <thead>
            <tr><th className="gutter" />{Array.from({ length: 6 }, (_, i) => <th key={i} className="gutter">{String.fromCharCode(65 + i)}</th>)}</tr>
            <tr className="labels"><th className="gutter w-8">#</th><th>Name</th><th>Attendance</th><th>Times Drove</th><th>Miles Drove</th><th>Minutes Drove</th></tr>
          </thead>
          <tbody>
            {roster.map((m, i) => {
              const d = driverStats[m.user_id], p = m.profile;
              // Shown = computed + the admin's correction (migrations 0025, 0043).
              const att = attendanceYes[m.user_id] ?? 0, drives = d?.timesDriven ?? 0, miles = d?.milesDriven ?? 0, mins = d?.minutesDriven ?? 0;
              const shown = {
                attendance: att + p.attendance_adjustment,
                drives: drives + (p.drives_adjustment ?? 0),
                miles: Math.round((miles + Number(p.miles_adjustment ?? 0)) * 10) / 10,
                minutes: Math.round(mins + Number(p.minutes_adjustment ?? 0)),
              };
              const cell = (field: keyof typeof shown, computed: number, text: string, step = 1) =>
                isAdmin ? <StatCell userId={m.user_id} field={field} computed={computed} value={shown[field]} step={step} /> : text;
              return (
                <tr key={m.user_id}>
                  <td className="gutter">{i + 1}</td>
                  <td className="font-medium whitespace-nowrap">{p.full_name || p.email}</td>
                  <td>{cell("attendance", att, String(shown.attendance))}</td>
                  <td><span className="flex items-center gap-1">{cell("drives", drives, String(shown.drives))}<DrivesInfo items={drivesBreakdown(m.user_id, p.drives_adjustment ?? 0)} /></span></td>
                  <td>{cell("miles", miles, shown.miles.toFixed(1), 0.1)}</td>
                  <td>{cell("minutes", mins, String(shown.minutes))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PairsView pairs={pairStats} names={names} />
    </div>
  );
}
