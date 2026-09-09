"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion, Json } from "@/lib/database.types";
import { cleanHtml } from "@/lib/html";
import { defaultSheetColumns } from "@/lib/google-sheets";

/** Start a form from a template. "practice" = the automatic weight question is on; "blank" = custom questions only. */
export async function createForm(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const template = String(fd.get("template") ?? "practice");
  const supabase = await createClient();
  const { data, error } = await supabase.from("forms")
    .insert({ org_id: org.id, title: "Untitled form", created_by: userId, ask_weight: template === "practice", ...(await defaultSheetColumns(userId)) })
    .select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/admin/forms/${data.id}`);
}

/** Create a fresh blank template and open it in the editor. */
export async function createTemplate() {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("forms")
    .insert({ org_id: org.id, created_by: userId, title: "Untitled template", status: "template", ask_weight: false })
    .select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/admin/forms/${data.id}`);
}

/** Start a draft form as a copy of a template (the editable cards next to "Blank form"). */
export async function createFromTemplate(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const { data: tpl } = await supabase.from("forms").select("*").eq("id", String(fd.get("template_id"))).eq("org_id", org.id).eq("status", "template").maybeSingle();
  if (!tpl) throw new Error("Template not found");
  const { data, error } = await supabase.from("forms")
    .insert({ org_id: org.id, created_by: userId, title: tpl.title, description: tpl.description, questions: tpl.questions, ask_weight: tpl.ask_weight, ...(await defaultSheetColumns(userId)) })
    .select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/admin/forms/${data.id}`);
}

/** Create a draft form pre-linked to every day in an event group, then open the editor.
 * Starts from the org's oldest template (usually "Practice form") when one exists. */
export async function createFormForGroup(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const groupId = String(fd.get("group_id"));
  const supabase = await createClient();
  const [{ data: group }, { data: events }] = await Promise.all([
    supabase.from("event_groups").select("id, name").eq("id", groupId).eq("org_id", org.id).maybeSingle(),
    supabase.from("events").select("id").eq("group_id", groupId).eq("org_id", org.id).order("starts_at"),
  ]);
  if (!group) throw new Error("Group not found");
  const { data: tpl } = await supabase.from("forms").select("*").eq("org_id", org.id).eq("status", "template").order("created_at").limit(1).maybeSingle();
  const { data: form, error } = await supabase.from("forms")
    .insert({ org_id: org.id, created_by: userId, title: `${group.name} Form`,
      description: tpl?.description ?? "", questions: tpl?.questions ?? [], ask_weight: tpl?.ask_weight ?? true, ...(await defaultSheetColumns(userId)) })
    .select("id").single();
  if (error) throw new Error(error.message);
  if (events?.length) await supabase.from("form_events").insert(events.map((e, i) => ({ form_id: form.id, event_id: e.id, sort_order: i })));
  revalidatePath("/admin/forms"); revalidatePath(`/groups/${groupId}`);
  redirect(`/admin/forms/${form.id}`);
}

export type FormPayload = {
  title: string; description: string; due_at: string | null; status: "draft" | "open" | "closed" | "template";
  ask_weight: boolean;
  questions: FormQuestion[];
  events: { event_id: string; prompt: string | null }[];
};

export async function saveForm(id: string, p: FormPayload) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("forms")
    .update({ title: p.title.trim() || "Untitled form", description: cleanHtml(p.description), due_at: p.due_at, status: p.status, ask_weight: p.ask_weight, questions: p.questions.map((q) => ({ ...q, help: q.help ? cleanHtml(q.help) : undefined })) as unknown as Json })
    .eq("id", id).eq("org_id", org.id);
  if (error) return { error: error.message };
  // Replace event links.
  await supabase.from("form_events").delete().eq("form_id", id);
  if (p.events.length) {
    const { error: e2 } = await supabase.from("form_events")
      .insert(p.events.map((e, i) => ({ form_id: id, event_id: e.event_id, prompt: e.prompt, sort_order: i })));
    if (e2) return { error: e2.message };
  }
  revalidatePath(`/admin/forms/${id}`); revalidatePath("/admin/forms"); revalidatePath("/forms"); revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteForm(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  await supabase.from("forms").delete().eq("id", String(fd.get("id"))).eq("org_id", org.id);
  revalidatePath("/admin/forms"); revalidatePath("/forms");
  redirect("/admin/forms");
}

export async function duplicateForm(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const { data: src } = await supabase.from("forms").select("*").eq("id", String(fd.get("id"))).eq("org_id", org.id).single();
  if (!src) return;
  const { data: copy } = await supabase.from("forms").insert({
    org_id: org.id, created_by: userId, title: `${src.title} (copy)`, description: src.description, questions: src.questions, ask_weight: src.ask_weight, status: "draft", ...(await defaultSheetColumns(userId)),
  }).select("id").single();
  if (copy) redirect(`/admin/forms/${copy.id}`);
}
