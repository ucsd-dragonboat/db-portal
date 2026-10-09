import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncFormToSheet } from "@/lib/sheet-sync";
import { parseAttendance } from "@/lib/attendance";
import { notifyFormSubmitted } from "@/lib/notifications";
import type { Database, FormQuestion, Json } from "@/lib/database.types";
import { cleanHtml, htmlToText } from "@/lib/html";
import { testPattern } from "@/lib/pattern";
import { attachPickupCoords, notFoundWarning } from "@/lib/geocode";

export type SubmitState = { error?: string; saved?: boolean; warning?: string };

/** Validates and saves weight / attendance / answers for `userId` using their own (RLS-scoped) client.
 * `asAdmin`: an admin editing someone's response from the Responses tab (service-role
 * client) — works on closed forms too, keeps the member's own submitted time, and
 * doesn't send the "new response" notification. */
export async function saveResponse(supabase: SupabaseClient<Database>, userId: string, fd: FormData, opts: { asAdmin?: boolean } = {}): Promise<SubmitState> {
  const user = { id: userId };
  const formId = String(fd.get("form_id"));

  const [{ data: form }, { data: links }] = await Promise.all([
    supabase.from("forms").select("*").eq("id", formId).maybeSingle(),
    supabase.from("form_events").select("event_id").eq("form_id", formId),
  ]);
  if (!form || (opts.asAdmin ? form.status === "template" : form.status !== "open")) return { error: "This form is not accepting responses." };

  // 1. optional weight update
  const w = String(fd.get("weight_lb") ?? "").trim();
  if (w) await supabase.from("profiles").update({ weight_lb: Number(w) }).eq("id", user.id);

  // 2. per-event attendance → rsvps (validate all, then one batched upsert)
  // A ride-only address typed once at the top applies to every day where the member
  // is driving or riding from "home" — a per-day address or pickup spot still wins.
  const rideAddress = String(fd.get("ride_address") ?? "").trim();
  const parsed = [];
  for (const l of links ?? []) {
    const v = parseAttendance(fd, `ev_${l.event_id}_`);
    if (!v) return { error: "Please answer every attendance question." };
    if (rideAddress && (v.ride === "driver" || v.ride === "needs_ride") && !v.pickup_address && !v.pickup_location_id) v.pickup_address = rideAddress;
    parsed.push({ event_id: l.event_id, user_id: user.id, form_id: formId, ...v });
  }
  let warning: string | undefined;
  if (parsed.length) {
    const { rows: rsvpRows, notFound } = await attachPickupCoords(supabase, user.id, parsed);
    warning = notFoundWarning(notFound);
    const { error } = await supabase.from("rsvps").upsert(rsvpRows);
    if (error) return { error: error.message.includes("pickup_lat") ? "Run migration 0029_rsvp_pickup_coords.sql first" : error.message };
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
    if (!empty && q.answer_pattern && ["short_text", "long_text", "number"].includes(q.type)) {
      // Paragraph answers are stored as HTML — match the text the member typed, not the tags.
      const text = q.type === "long_text" ? htmlToText(val as string) : String(val);
      if (!testPattern(q.answer_pattern, text))
        return { error: q.answer_error?.trim() || `"${htmlToText(q.label)}" isn't in the expected format.` };
    }
    answers[q.id] = val;
  }
  // An admin's edit keeps the member's own submitted time (and so their on-time/late
  // status); a response an admin enters for someone who never submitted is stamped now.
  const { data: prior } = opts.asAdmin
    ? await supabase.from("form_responses").select("submitted_at").eq("form_id", formId).eq("user_id", user.id).maybeSingle()
    : { data: null };
  const { error } = await supabase.from("form_responses").upsert({ form_id: formId, user_id: user.id, answers, submitted_at: prior?.submitted_at ?? new Date().toISOString() });
  if (error) return { error: error.message };

  // Mirror to the linked Google Sheet after the response is sent — never blocks the submitter.
  if (form.sheet_spreadsheet_id) after(() => syncFormToSheet(formId));
  if (!opts.asAdmin) after(() => notifyFormSubmitted(form.org_id, formId, userId, form.title));

  revalidatePath(`/admin/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}`); revalidatePath("/forms"); revalidatePath("/events"); revalidatePath("/dashboard");
  return { saved: true, warning };
}
