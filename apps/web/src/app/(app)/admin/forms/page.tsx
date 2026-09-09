import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion } from "@/lib/database.types";
import FormsHome, { type FormRow, type TemplateRow } from "./forms-home";

export default async function AdminFormsPage() {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const [{ data: allForms }, { count: memberCount }] = await Promise.all([
    supabase.from("forms").select("*, form_responses(count), form_events(count)").eq("org_id", org.id).order("created_at", { ascending: false }),
    supabase.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", org.id),
  ]);
  const templates: TemplateRow[] = (allForms ?? []).filter((f) => f.status === "template").map((t) => ({
    id: t.id, title: t.title, ask_weight: t.ask_weight,
    qLabels: ((t.questions as unknown as FormQuestion[]) ?? []).map((q) => q.label).filter(Boolean).slice(0, 4),
  }));
  const forms: FormRow[] = (allForms ?? []).filter((f) => f.status !== "template").map((f) => ({
    id: f.id, title: f.title, status: f.status, due_at: f.due_at, created_at: f.created_at,
    responses: (f.form_responses as unknown as { count: number }[])[0]?.count ?? 0, events: (f.form_events as unknown as { count: number }[])[0]?.count ?? 0,
  }));
  return <FormsHome forms={forms} templates={templates} memberCount={memberCount ?? 0} />;
}
