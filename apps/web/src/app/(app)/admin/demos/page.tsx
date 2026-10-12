import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_GEO_BUDGET, MAX_LIVE_SANDBOXES, PER_SANDBOX_DAILY, demoEnabled } from "@/lib/demo";
import { TEAM_TZ, fmtDateTime, fmtTime } from "@/lib/format";
import { setDemoEnabled } from "@/app/demo/actions";
import ConfirmForm from "@/components/confirm-form";
import { deleteAllDemos, deleteDemo, setDemoExpiry, setDemoHours } from "./actions";

const LIFETIMES = [1, 3, 6, 12, 24, 48, 72, 168];
const hoursLabel = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TEAM_TZ });

/** Everything the page shows, read with the service role (it spans every sandbox). */
async function loadDemoStats() {
  const admin = createAdminClient();
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400e3).toISOString();
  const [enabled, hoursRow, orgs, accounts, log, allTime, limits] = await Promise.all([
    demoEnabled(),
    admin.from("site_settings").select("demo_hours").maybeSingle(),
    admin.from("organizations").select("id, created_at, demo_expires_at").eq("is_demo", true).order("created_at", { ascending: false }),
    admin.from("memberships").select("user_id, organizations!inner(is_demo)", { count: "exact", head: true }).eq("organizations.is_demo", true),
    admin.from("demo_log").select("started_at, ended_at").gte("started_at", since30).limit(10000),
    admin.from("demo_log").select("org_id", { count: "exact", head: true }),
    admin.from("rate_limits").select("key, count, window_start").like("key", "demo-%"),
  ]);

  // Rate-limit windows: a counter only counts while its window is open.
  const open = (r: { window_start: string }, seconds: number) => new Date(r.window_start).getTime() > now - seconds * 1000;
  const rows = limits.data ?? [];
  const geo = Object.entries(DEMO_GEO_BUDGET).map(([provider, budget]) => {
    const r = rows.find((x) => x.key === `demo-geo:${provider}` && open(x, 86400));
    return { provider, budget, used: r?.count ?? 0, resets: r ? new Date(new Date(r.window_start).getTime() + 86400e3).toISOString() : null };
  });
  const perOrg = new Map(rows.filter((x) => x.key.startsWith("demo-geo-org:") && open(x, 86400)).map((x) => [x.key.slice(13), x.count]));
  const visitors = rows.filter((x) => x.key.startsWith("demo-create:") && open(x, 3600));

  const started = (log.data ?? []).map((l) => new Date(l.started_at));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * 86400e3);
    const key = dayKey(d);
    return { key, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: TEAM_TZ }), n: started.filter((s) => dayKey(s) === key).length };
  });
  const ended = (log.data ?? []).filter((l) => l.ended_at);
  const avgHours = ended.length ? ended.reduce((s, l) => s + (new Date(l.ended_at!).getTime() - new Date(l.started_at).getTime()), 0) / ended.length / 3600e3 : null;

  return {
    enabled,
    lifetime: hoursRow.data?.demo_hours ?? 24,
    logReady: !log.error,
    sandboxes: (orgs.data ?? []).map((o) => ({
      ...o,
      hoursLeft: o.demo_expires_at ? (new Date(o.demo_expires_at).getTime() - now) / 3600e3 : null,
      geoCalls: perOrg.get(o.id) ?? 0,
    })),
    accounts: accounts.count ?? 0,
    counts: {
      today: days[13].n,
      week: days.slice(7).reduce((s, d) => s + d.n, 0),
      month: started.length,
      allTime: allTime.count ?? 0,
    },
    avgHours,
    days,
    geo,
    visitors: { ips: visitors.length, blocked: visitors.filter((v) => v.count > 3).length },
  };
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card py-3">
      <div className="text-xs" style={{ color: "var(--g-grey-600)" }}>{label}</div>
      <div className="text-2xl">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default async function AdminDemosPage() {
  const { org } = await requireAdmin();
  // Spans every sandbox, so real teams only.
  if (org.is_demo) notFound();
  const s = await loadDemoStats();
  const maxDay = Math.max(1, ...s.days.map((d) => d.n));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-normal">Demos</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
          Every throwaway sandbox started from the demo QR code: who&rsquo;s running, how much of the map/routing budget they&rsquo;ve used, and controls to extend or delete them.
        </p>
      </div>

      {!s.logReady && (
        <div className="card py-3 text-sm text-amber-700">Run <code>supabase/migrations/0038_demo_monitor.sql</code> in Supabase to turn on history and the lifetime setting.</div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card py-3 space-y-1">
          <div className="text-xs" style={{ color: "var(--g-grey-600)" }}>Demo</div>
          <div className="text-2xl">{s.enabled ? "On" : "Off"}</div>
          <form action={setDemoEnabled}>
            <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
            <button className={s.enabled ? "text-xs text-red-600 underline" : "btn-purple text-xs"}>{s.enabled ? "Turn off" : "Turn on"}</button>
          </form>
        </div>
        <Stat label="Live sandboxes" value={<>{s.sandboxes.length}<span className="text-sm text-slate-400"> / {MAX_LIVE_SANDBOXES}</span></>} sub="cap on simultaneous sandboxes" />
        <Stat label="Demo accounts" value={s.accounts} sub="visitors + fake teammates (can't sign in)" />
        <div className="card py-3 space-y-1">
          <div className="text-xs" style={{ color: "var(--g-grey-600)" }}>New sandboxes last</div>
          <form action={setDemoHours} className="flex items-center gap-1">
            <select name="hours" defaultValue={String(s.lifetime)} className="input py-0.5 text-sm w-auto" disabled={!s.logReady}>
              {(LIFETIMES.includes(s.lifetime) ? LIFETIMES : [...LIFETIMES, s.lifetime].sort((a, b) => a - b)).map((h) => <option key={h} value={h}>{hoursLabel(h)}</option>)}
            </select>
            <button className="btn-text py-0.5 text-xs" disabled={!s.logReady}>Save</button>
          </form>
          <div className="text-xs text-slate-400">running ones keep their time</div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Started</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Today" value={s.counts.today} />
          <Stat label="Last 7 days" value={s.counts.week} />
          <Stat label="Last 30 days" value={s.counts.month} />
          <Stat label="All time" value={s.counts.allTime} sub="since history began (0038)" />
          <Stat label="Avg. lifetime" value={s.avgHours == null ? "—" : `${s.avgHours.toFixed(1)} h`} sub="ended sandboxes, 30 days" />
        </div>
        <div className="card py-3">
          <div className="flex items-end gap-1 h-24">
            {s.days.map((d) => (
              <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.label}: ${d.n}`}>
                <span className="text-[10px] text-slate-500">{d.n || ""}</span>
                <div className="w-full rounded-t" style={{ height: `${(d.n / maxDay) * 100}%`, minHeight: d.n ? 3 : 1, background: d.n ? "var(--g-purple)" : "var(--g-grey-300)" }} />
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-1">
            {s.days.map((d, i) => <div key={d.key} className="flex-1 text-center text-[10px] text-slate-400">{i % 2 === 1 ? d.label : ""}</div>)}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Last hour: {s.visitors.ips} visitor{s.visitors.ips === 1 ? "" : "s"} (by network){s.visitors.blocked ? `, ${s.visitors.blocked} hit the 3-per-hour limit` : ""}. &ldquo;Start over&rdquo; counts as a new sandbox.
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Map &amp; routing API usage today</h2>
        <p className="text-sm text-slate-500">Demo-wide daily budgets (about 10% of each free allowance), plus {PER_SANDBOX_DAILY} calls per sandbox. Over budget, demos quietly fall back to straight-line estimates. Real teams are never limited and aren&rsquo;t counted here.</p>
        <div className="card py-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--g-grey-600)" }}><th className="py-1 font-normal">Service</th><th className="font-normal">Used / budget</th><th className="font-normal w-1/3"></th><th className="font-normal">Resets</th></tr>
            </thead>
            <tbody>
              {s.geo.map((g) => {
                const pct = Math.min(100, (g.used / g.budget) * 100);
                return (
                  <tr key={g.provider} className="border-t" style={{ borderColor: "var(--g-grey-300)" }}>
                    <td className="py-1.5">{g.provider}</td>
                    <td>{Math.min(g.used, g.budget)} / {g.budget}{g.used > g.budget && <span className="text-red-600 text-xs"> ({g.used - g.budget} refused)</span>}</td>
                    <td><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--g-red)" : pct >= 75 ? "var(--g-yellow)" : "var(--g-green)" }} /></div></td>
                    <td className="text-xs text-slate-500">{g.resets ? fmtTime(g.resets) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Live sandboxes</h2>
          {s.sandboxes.length > 0 && (
            <ConfirmForm action={deleteAllDemos} message={`Delete all ${s.sandboxes.length} sandboxes now? Anyone using one is signed out.`}>
              <button className="text-xs text-red-600 underline">Delete all</button>
            </ConfirmForm>
          )}
        </div>
        {s.sandboxes.length === 0 ? (
          <div className="card py-3 text-sm text-slate-500">No sandboxes running.</div>
        ) : (
          <div className="card py-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--g-grey-600)" }}><th className="py-1 font-normal">Sandbox</th><th className="font-normal">Started</th><th className="font-normal">Expires</th><th className="font-normal">API calls today</th><th className="font-normal">Set expiry</th><th></th></tr>
              </thead>
              <tbody>
                {s.sandboxes.map((d) => (
                  <tr key={d.id} className="border-t" style={{ borderColor: "var(--g-grey-300)" }}>
                    <td className="py-1.5 font-mono text-xs">{d.id.slice(0, 8)}</td>
                    <td className="text-xs">{fmtDateTime(d.created_at)}</td>
                    <td className="text-xs">
                      {d.hoursLeft == null ? "never" : d.hoursLeft <= 0
                        ? <span className="text-red-600">expired — deleting within 10 min</span>
                        : <>{d.hoursLeft < 1 ? `${Math.max(1, Math.round(d.hoursLeft * 60))} min` : `${Math.round(d.hoursLeft)} h`} <span className="text-slate-400">({fmtDateTime(d.demo_expires_at!)})</span></>}
                    </td>
                    <td className={d.geoCalls >= PER_SANDBOX_DAILY ? "text-red-600" : ""}>{Math.min(d.geoCalls, PER_SANDBOX_DAILY)} / {PER_SANDBOX_DAILY}</td>
                    <td>
                      <form action={setDemoExpiry} className="flex items-center gap-1">
                        <input type="hidden" name="org_id" value={d.id} />
                        <select name="hours" defaultValue="24" className="input py-0.5 text-xs w-auto">
                          {LIFETIMES.map((h) => <option key={h} value={h}>in {hoursLabel(h)}</option>)}
                        </select>
                        <button className="btn-text py-0.5 text-xs">Set</button>
                      </form>
                    </td>
                    <td className="text-right">
                      <ConfirmForm action={deleteDemo} message="Delete this sandbox now? Its visitor is signed out.">
                        <input type="hidden" name="org_id" value={d.id} />
                        <button className="text-xs text-red-600 underline">Delete</button>
                      </ConfirmForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
