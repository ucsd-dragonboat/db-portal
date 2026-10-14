import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCampusSpots } from "@/lib/campus-spots";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion } from "@/lib/database.types";
import FormEditor from "./editor";
import FormTabs from "@/components/form-tabs";
import AutoRefresh from "@/components/auto-refresh";
import CarpoolStatusBadge from "@/components/carpool-status";
import LocalTime from "@/components/local-time";
import { latestRuns, queuedDays, runLabel } from "@/lib/carpool-runs";

// events from the last two weeks onward are offered for linking
const sinceIso = () => new Date(Date.now() - 14 * 86400e3).toISOString();

export default async function AdminFormEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const [{ data: form }, { data: links }, { data: events }, { count }, { data: groups }, { data: pickups }] = await Promise.all([
    supabase.from("forms").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("form_events").select("*").eq("form_id", id).order("sort_order"),
    supabase.from("events").select("id, title, kind, starts_at, group_id").eq("org_id", org.id).gte("starts_at", sinceIso()).order("starts_at"),
    supabase.from("form_responses").select("*", { count: "exact", head: true }).eq("form_id", id),
    supabase.from("event_groups").select("id, name").eq("org_id", org.id).order("created_at", { ascending: false }).limit(20),
    loadCampusSpots(supabase, org.id).then((data) => ({ data })),
  ]);
  if (!form) notFound();
  const dayIds = (links ?? []).map((l) => l.event_id);
  const carpools = form.due_at && dayIds.length ? await carpoolStatus(supabase, form, dayIds) : null;
  return (
    <div className="gf-page -m-4 md:-m-6 min-h-full p-4 md:p-6">
      <FormTabs id={id} responses={count ?? 0} joinCode={org.join_code} />
      {carpools}
      <FormEditor
        id={id}
        initial={{ title: form.title, description: form.description, due_at: form.due_at, status: form.status, ask_weight: form.ask_weight, ...(form.campus_pickup ? { campus_pickup: form.campus_pickup } : {}), questions: (form.questions as unknown as FormQuestion[]) ?? [], events: (links ?? []).map((l) => ({ event_id: l.event_id, prompt: l.prompt })) }}
        events={events ?? []}
        groups={(groups ?? []).filter((g) => (events ?? []).some((e) => e.group_id === g.id))}
        pickups={pickups ?? []}
      />
    </div>
  );
}

/** Each linked day's auto-carpool status — the cron builds one carpool per day
 * after the due date, a day at a time. */
async function carpoolStatus(supabase: Awaited<ReturnType<typeof createClient>>, form: { due_at: string | null }, dayIds: string[]) {
  const [{ data: days }, runBy, queued] = await Promise.all([
    supabase.from("events").select("id, title, starts_at").in("id", dayIds).order("starts_at"),
    latestRuns(supabase, dayIds),
    queuedDays(supabase, dayIds),
  ]);
  const rows = (days ?? []).map((d) => ({ ...d, status: runLabel(runBy.get(d.id), queued.has(d.id)) }));
  const beforeDue = new Date(form.due_at!).getTime() > Date.now();
  return (
    <div className="card mx-auto mb-3 max-w-[760px] space-y-2 text-sm">
      <AutoRefresh active={rows.some((r) => r.status?.active)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Carpools</h2>
        <Link href="/admin/carpool/jobs" className="btn-text text-xs" style={{ color: "var(--g-red)" }}>Job queue →</Link>
      </div>
      {beforeDue && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>A draft carpool is built for each day after the deadline (<LocalTime iso={form.due_at!} />).</p>}
      <ul className="divide-y" style={{ borderColor: "var(--g-grey-300)" }}>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 font-medium">{r.title}</span>
            <span className="text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={r.starts_at} /></span>
            <span className="min-w-0 flex-1"><CarpoolStatusBadge status={r.status} /></span>
            <Link href={`/admin/carpool?event=${r.id}`} className="btn-text text-xs" style={{ color: "var(--g-red)" }}>Open →</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
