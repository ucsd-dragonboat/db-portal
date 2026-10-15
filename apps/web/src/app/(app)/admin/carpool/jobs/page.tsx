import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { CarpoolRun } from "@/lib/database.types";
import { RUN_MAX_ATTEMPTS, runLabel } from "@/lib/carpool-runs";
import AutoRefresh from "@/components/auto-refresh";
import CarpoolStatusBadge from "@/components/carpool-status";
import LocalTime from "@/components/local-time";
import Icon from "@/components/icon";
import { cancelJob, retryJob } from "./actions";

const DAY = 86400e3;
const clock = () => Date.now(); // a module-level helper, like sinceIso() on the form page

export const metadata = { title: "Carpool · Job queue" };

export default async function CarpoolJobsPage() {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const now = clock();
  const [{ data: runRows, error }, { data: waitingForms }] = await Promise.all([
    supabase.from("carpool_runs").select("*").eq("org_id", org.id).gte("started_at", new Date(now - 14 * DAY).toISOString())
      .order("started_at", { ascending: false }).limit(300),
    supabase.from("forms").select("id, title, due_at").eq("org_id", org.id).in("status", ["open", "closed"])
      .not("due_at", "is", null).lt("due_at", new Date(now).toISOString()).is("carpools_generated_at", null),
  ]);
  const runs = (runRows ?? []) as CarpoolRun[];

  const eventIds = [...new Set(runs.map((r) => r.event_id))];
  const formIds = [...new Set([...runs.map((r) => r.form_id).filter((x): x is string => !!x), ...(waitingForms ?? []).map((f) => f.id)])];
  const [{ data: events }, { data: forms }, { data: waitingDays }] = await Promise.all([
    eventIds.length ? supabase.from("events").select("id, title, starts_at").in("id", eventIds) : Promise.resolve({ data: [] }),
    formIds.length ? supabase.from("forms").select("id, title").in("id", formIds) : Promise.resolve({ data: [] }),
    waitingForms?.length ? supabase.from("form_events").select("form_id").in("form_id", waitingForms.map((f) => f.id)) : Promise.resolve({ data: [] }),
  ]);
  const eventBy = new Map((events ?? []).map((e) => [e.id, e]));
  const formBy = new Map((forms ?? []).map((f) => [f.id, f.title]));
  const daysPerForm = new Map<string, number>();
  for (const fe of waitingDays ?? []) daysPerForm.set(fe.form_id, (daysPerForm.get(fe.form_id) ?? 0) + 1);
  const waiting = (waitingForms ?? []).filter((f) => daysPerForm.get(f.id));

  // A day's newest run decides whether it can be retried.
  const newest = new Map<string, string>();
  for (const r of runs) if (!newest.has(r.event_id)) newest.set(r.event_id, r.id);
  const weekAgo = now - 7 * DAY;
  const recent = (r: CarpoolRun) => new Date(r.finished_at ?? r.started_at).getTime() >= weekAgo;
  const counts = [
    { label: "Queued", n: runs.filter((r) => r.status === "queued").length + waiting.reduce((n, f) => n + (daysPerForm.get(f.id) ?? 0), 0), color: "var(--g-purple)" },
    { label: "Running", n: runs.filter((r) => r.status === "running").length, color: "var(--g-purple)" },
    { label: "Built (7 days)", n: runs.filter((r) => r.status === "done" && recent(r)).length, color: "var(--g-green)" },
    { label: "Failed (7 days)", n: runs.filter((r) => r.status === "error" && recent(r)).length, color: "var(--g-red)" },
  ];
  const active = waiting.length > 0 || runs.some((r) => r.status === "queued" || r.status === "running");
  const grey = { color: "var(--g-grey-600)" };

  return (
    <div className="max-w-5xl space-y-4">
      <AutoRefresh active={active} />
      <div>
        <Link href="/admin/carpool" className="btn-text -ml-3" style={{ color: "var(--g-red)" }}>← Carpool</Link>
        <h1 className="text-2xl font-normal"><Icon name="car" /> Carpool job queue</h1>
        <p className="text-sm" style={grey}>
          When a form&rsquo;s deadline passes, each of its days is queued for an automatic draft carpool. The queue runs every 10 minutes and builds
          as many days as fit in each run; the rest go in the next run. A day that fails or times out is retried up to {RUN_MAX_ATTEMPTS} times.
          Admins&rsquo; Optimize clicks are listed too. The last 14 days are shown.
        </p>
      </div>

      {error && <p className="card text-sm" style={{ color: "var(--g-red)" }}>Couldn&rsquo;t load jobs: {error.message}. Has migration 0040 been run?</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((c) => (
          <div key={c.label} className="card !py-3">
            <div className="text-2xl" style={{ color: c.n ? c.color : "var(--g-grey-600)" }}>{c.n}</div>
            <div className="text-xs" style={grey}>{c.label}</div>
          </div>
        ))}
      </div>

      {waiting.length > 0 && (
        <section className="card space-y-1 text-sm">
          <h2 className="font-medium">Waiting for the next run</h2>
          {waiting.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/admin/forms/${f.id}`} className="hover:underline">{f.title}</Link>
              <span className="text-xs" style={grey}>{daysPerForm.get(f.id)} day{daysPerForm.get(f.id) === 1 ? "" : "s"} · deadline <LocalTime iso={f.due_at!} /></span>
            </div>
          ))}
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: "var(--g-grey-300)" }}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs" style={grey}>
            <tr><th className="p-2">Day</th><th className="p-2">Form</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Tries</th><th className="p-2">Started</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {!runs.length && <tr><td colSpan={7} className="p-3" style={grey}>No carpool jobs in the last 14 days.</td></tr>}
            {runs.map((r) => {
              const ev = eventBy.get(r.event_id);
              const canRetry = r.trigger === "cron" && (r.status === "error" || r.status === "skipped") && newest.get(r.event_id) === r.id;
              return (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: "var(--g-grey-300)" }}>
                  <td className="p-2">
                    <Link href={`/admin/carpool?event=${r.event_id}`} className="font-medium hover:underline">{ev?.title ?? "Deleted day"}</Link>
                    {ev && <div className="text-xs" style={grey}><LocalTime iso={ev.starts_at} /></div>}
                  </td>
                  <td className="p-2">{r.form_id ? <Link href={`/admin/forms/${r.form_id}`} className="hover:underline">{formBy.get(r.form_id) ?? "Form"}</Link> : <span style={grey}>—</span>}</td>
                  <td className="p-2">{r.trigger === "cron" ? "Auto" : "Optimize"}</td>
                  <td className="max-w-xs p-2"><CarpoolStatusBadge status={runLabel(r, false)} /></td>
                  <td className="p-2">{r.trigger === "cron" ? `${r.attempts}/${RUN_MAX_ATTEMPTS}` : "—"}</td>
                  <td className="whitespace-nowrap p-2 text-xs" style={grey}><LocalTime iso={r.started_at} /></td>
                  <td className="whitespace-nowrap p-2 text-right">
                    {canRetry && <form action={retryJob.bind(null, r.id)}><button className="btn-text text-xs" style={{ color: "var(--g-red)" }}>Retry</button></form>}
                    {r.status === "queued" && <form action={cancelJob.bind(null, r.id)}><button className="btn-text text-xs" style={grey}>Cancel</button></form>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
