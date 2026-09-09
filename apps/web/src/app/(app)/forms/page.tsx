import Link from "next/link";
import Icon from "@/components/icon";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";

export default async function FormsPage() {
  const { org, userId } = await requireOrg();
  const supabase = await createClient();
  // The embed filter keeps this to *my* response per form instead of every member's.
  const { data: forms } = await supabase.from("forms").select("id, title, due_at, status, form_responses(user_id, submitted_at)").eq("org_id", org.id)
    .neq("status", "draft").eq("form_responses.user_id", userId).order("status").order("due_at", { ascending: true, nullsFirst: false });
  const mine = (f: { form_responses: { user_id: string; submitted_at: string }[] }) => f.form_responses.find((r) => r.user_id === userId);
  const open = (forms ?? []).filter((f) => f.status === "open");
  const closed = (forms ?? []).filter((f) => f.status === "closed");
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-normal mb-3">Open forms</h1>
        {!open.length && <p className="text-slate-500">Nothing to fill out right now <Icon name="party" /></p>}
        <ul className="space-y-2">
          {open.map((f) => { const r = mine(f); return (
            <li key={f.id}><Link href={`/forms/${f.id}`} className="card flex items-center justify-between gap-3 hover:border-sky-400">
              <div><div className="font-medium">{f.title}</div>{f.due_at && <div className="text-xs text-slate-500">Due <LocalTime iso={f.due_at} /></div>}</div>
              <div className={`text-sm ${r ? "text-green-700" : "text-amber-600 font-medium"}`}>{r ? <>✓ Submitted <LocalTime iso={r.submitted_at} /></> : "Needs response"}</div>
            </Link></li>); })}
        </ul>
      </section>
      {closed.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-2 text-slate-600">Closed</h2>
          <ul className="space-y-1">
            {closed.map((f) => <li key={f.id}><Link href={`/forms/${f.id}`} className="text-sm text-slate-600 hover:underline">{f.title}</Link>{mine(f) ? <span className="text-xs text-slate-400"> · responded</span> : ""}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
