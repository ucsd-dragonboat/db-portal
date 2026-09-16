import { computeDriverStats, computePairStats, type Trip } from "@db/carpool";
import Icon from "@/components/icon";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { CarpoolTrip, Membership, Profile } from "@/lib/database.types";
import { AttendanceCell, PairsView } from "./forms";

export default async function StatisticsPage() {
  const { org, isAdmin } = await requireOrg();
  const supabase = await createClient();

  const [{ data: members }, { data: events }, { data: trips }] = await Promise.all([
    supabase.from("memberships").select("*, profile:profiles(*)").eq("org_id", org.id),
    supabase.from("events").select("id").eq("org_id", org.id),
    supabase.from("carpool_trips").select("*").eq("org_id", org.id),
  ]);
  const roster = ((members ?? []) as (Membership & { profile: Profile })[]).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: yesRsvps } = eventIds.length
    ? await supabase.from("rsvps").select("user_id").in("event_id", eventIds).eq("status", "yes")
    : { data: [] as { user_id: string }[] };

  const attendanceYes: Record<string, number> = {};
  for (const r of yesRsvps ?? []) attendanceYes[r.user_id] = (attendanceYes[r.user_id] ?? 0) + 1;

  const carpoolTrips: Trip[] = ((trips ?? []) as CarpoolTrip[]).map((t) => ({
    driverId: t.driver_id, passengerIds: t.passenger_ids, distanceKm: t.distance_km, durationMin: t.duration_min,
  }));
  const driverStats = computeDriverStats(carpoolTrips);
  const pairStats = computePairStats(carpoolTrips);
  const names = Object.fromEntries(roster.map((m) => [m.user_id, m.profile.full_name || m.profile.email]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Statistics</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
          Attendance and driving totals for the whole team. Miles/minutes only count carpools published after this page shipped.
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
              const d = driverStats[m.user_id];
              const attendance = (attendanceYes[m.user_id] ?? 0) + m.profile.attendance_adjustment;
              return (
                <tr key={m.user_id}>
                  <td className="gutter">{i + 1}</td>
                  <td className="font-medium whitespace-nowrap">{m.profile.full_name || m.profile.email}</td>
                  <td>{isAdmin ? <AttendanceCell userId={m.user_id} value={attendance} /> : attendance}</td>
                  <td>{d?.timesDriven ?? 0}</td>
                  <td>{d ? d.milesDriven.toFixed(1) : "0.0"}</td>
                  <td>{d ? Math.round(d.minutesDriven) : 0}</td>
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
