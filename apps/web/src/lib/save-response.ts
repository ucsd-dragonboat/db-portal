import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncFormToSheet } from "@/lib/sheet-sync";
import { parseAttendance } from "@/lib/attendance";
import type { Database, FormQuestion, Json } from "@/lib/database.types";
import { cleanHtml, htmlToText } from "@/lib/html";

export type SubmitState = { error?: string; saved?: boolean };

/** Validates and saves weight / attendance / answers for `userId` using their own (RLS-scoped) client. */
export async function saveResponse(supabase: SupabaseClient<Database>, userId: string, fd: FormData): Promise<SubmitState> {
  const user = { id: userId };
  const formId = String(fd.get("form_id"));

  const [{ data: form }, { data: links }] = await Promise.all([
    supabase.from("forms").select("*").eq("id", formId).maybeSingle(),
    supabase.from("form_events").select("event_id").eq("form_id", formId),
  ]);
  if (!form || form.status !== "open") return { error: "This form is not accepting responses." };

  // 1. optional weight update
  const w = String(fd.get("weight_lb") ?? "").trim();
  if (w) await supabase.from("profiles").update({ weight_lb: Number(w) }).eq("id", user.id);

  // 2. per-event attendance → rsvps (validate all, then one batched upsert)
  const rsvpRows = [];
  for (const l of links ?? []) {
    const v = parseAttendance(fd, `ev_${l.event_id}_`);
    if (!v) return { error: "Please answer every attendance question." };
    rsvpRows.push({ event_id: l.event_id, user_id: user.id, form_id: formId, ...v });
  }
  if (rsvpRows.length) {
    const { error } = await supabase.from("rsvps").upsert(rsvpRows);
    if (error) return { error: error.message };
  }

  // 3. custom answers
  const questions = (form.questions as unknown as FormQuestion[]) ?? [];
  const answers: Record<string, Json> = {};
  for (const q of questions) {
    if (q.type === "info" || q.type === "day") continue; // info card / day position marker — nothing to answer here
    const key = `q_${q.id}`;
    let val: Json = null;
    if (q.type === "multi_choice") val = fd.getAll(key).map(String);
    else if (q.type === "yes_no") { const s = fd.get(key); val = s === "yes" ? true : s === "no" ? false : null; }
    else if (q.type === "number") { const s = String(fd.get(key) ?? "").trim(); val = s ? Number(s) : null; }
    else if (q.type === "long_text") { const raw = String(fd.get(key) ?? "").trim(); const clean = raw ? cleanHtml(raw) : ""; val = htmlToText(clean).trim() ? clean : null; }
    else val = String(fd.get(key) ?? "").trim() || null;
    const empty = val === null || (Array.isArray(val) && !val.length);
    if (q.required && empty) return { error: `"${htmlToText(q.label)}" is required.` };
    answers[q.id] = val;
  }
  const { error } = await supabase.from("form_responses").upsert({ form_id: formId, user_id: user.id, answers, submitted_at: new Date().toISOString() });
  if (error) return { error: error.message };

  // Mirror to the linked Google Sheet after the response is sent — never blocks the submitter.
  if (form.sheet_spreadsheet_id) after(() => syncFormToSheet(formId));

  revalidatePath(`/forms/${formId}`); revalidatePath("/forms"); revalidatePath("/events"); revalidatePath("/dashboard");
  return { saved: true };
}
