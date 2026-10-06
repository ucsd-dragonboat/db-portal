// Bookkeeping for runs of the carpool algorithm (table carpool_runs, migration
// 0031): the auto-carpool cron and admins' Optimize clicks. Admin-only status —
// members never see it. Every write is best-effort: a missing table (migration not
// run yet) must never break generating or saving a carpool.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CarpoolRun, Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;
export type RunStatus = CarpoolRun["status"];
const runs = (db: Db) => db.from("carpool_runs");

export async function startRun(db: Db, r: { orgId: string; eventId: string; trigger: "cron" | "manual"; status?: RunStatus }): Promise<string | null> {
  try {
    const { data } = await runs(db).insert({ org_id: r.orgId, event_id: r.eventId, trigger: r.trigger, status: r.status ?? "running" }).select("id").single();
    return data?.id ?? null;
  } catch { return null; }
}

export async function updateRun(db: Db, id: string | null, patch: { status: RunStatus; detail?: string | null; provider?: string | null; carpoolId?: string | null }) {
  if (!id) return;
  const done = patch.status !== "queued" && patch.status !== "running";
  try {
    await runs(db).update({
      status: patch.status, detail: patch.detail ?? null, provider: patch.provider ?? null,
      ...(patch.carpoolId !== undefined ? { carpool_id: patch.carpoolId } : {}),
      ...(done ? { finished_at: new Date().toISOString() } : { started_at: new Date().toISOString() }),
    }).eq("id", id);
  } catch {}
}

/** The newest run per day. Empty when the table doesn't exist yet. */
export async function latestRuns(db: Db, eventIds: string[]): Promise<Map<string, CarpoolRun>> {
  const out = new Map<string, CarpoolRun>();
  if (!eventIds.length) return out;
  const { data, error } = await runs(db).select("*").in("event_id", eventIds).order("started_at", { ascending: false }).limit(500);
  if (error) return out;
  for (const r of data ?? []) if (!out.has(r.event_id)) out.set(r.event_id, r);
  return out;
}

/** Days whose linked form is past due but the cron hasn't picked up yet. */
export async function queuedDays(db: Db, eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const { data } = await db.from("form_events").select("event_id, form:forms(status, due_at, carpools_generated_at)").in("event_id", eventIds);
  const now = Date.now();
  return new Set((data ?? []).filter((fe) => {
    const f = fe.form as unknown as { status: string; due_at: string | null; carpools_generated_at: string | null } | null;
    return f && (f.status === "open" || f.status === "closed") && f.due_at && new Date(f.due_at).getTime() < now && !f.carpools_generated_at;
  }).map((fe) => fe.event_id));
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** What to show an admin about a day's carpool algorithm, or null for nothing. */
export function runLabel(run: CarpoolRun | undefined, queued: boolean): { text: string; color: string; active: boolean } | null {
  if (run?.status === "running") return { text: run.trigger === "cron" ? "Generating carpool…" : "Optimizing…", color: "var(--g-purple)", active: true };
  if (run?.status === "queued" || (queued && !run)) return { text: "Queued — the auto-carpool runs within 10 min", color: "var(--g-purple)", active: true };
  if (!run) return null;
  const when = ago(run.finished_at ?? run.started_at);
  const via = run.provider ? ` · via ${run.provider}` : run.status === "done" ? " · estimated distances (routing unavailable)" : "";
  const what = run.trigger === "cron" ? "Auto-built" : "Optimized";
  if (run.status === "done") return { text: `${what} ${when}${run.detail ? ` · ${run.detail}` : ""}${via}`, color: "var(--g-green)", active: false };
  if (run.status === "skipped") return { text: `Auto-carpool skipped ${when}: ${run.detail ?? ""}`, color: "var(--g-grey-600)", active: false };
  return { text: `${what === "Auto-built" ? "Auto-carpool" : "Optimize"} failed ${when}: ${run.detail ?? "unknown error"}`, color: "var(--g-red)", active: false };
}
