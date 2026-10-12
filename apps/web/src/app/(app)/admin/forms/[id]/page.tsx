import { notFound } from "next/navigation";
import { loadCampusSpots } from "@/lib/campus-spots";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion } from "@/lib/database.types";
import FormEditor from "./editor";
import FormTabs from "@/components/form-tabs";

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
  return (
    <div className="gf-page -m-4 md:-m-6 min-h-full p-4 md:p-6">
      <FormTabs id={id} responses={count ?? 0} joinCode={org.join_code} />
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
