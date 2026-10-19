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
import { parseBirthday } from "@/lib/birthday";
import { saveDefaultPickup } from "@/lib/default-pickup";
import { expireUser } from "@/lib/session-cache";
import { answeredParts } from "@/lib/form-sections";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileAllowed, isFileAnswer, maxBytes, maxFiles, type FileAnswer } from "@/lib/form-files";

export type SubmitState = { error?: string; saved?: boolean; warning?: string };

/** A File upload answer (JSON from the fill page) checked against what's really in
 * storage: only this form's folder, at most max_files, each within the question's size
 * and type rules. Stores the size and type Storage recorded, not what the browser said. */
async function checkFiles(orgId: string, formId: string, q: FormQuestion, raw: string): Promise<{ files: FileAnswer[] } | { error: string }> {
  const label = htmlToText(q.label);
  let picked: unknown = [];
  try { if (raw.trim()) picked = JSON.parse(raw); } catch { /* handled below */ }
  if (!isFileAnswer(picked)) return { error: `Couldn't read the files for "${label}" — please add them again.` };
  const prefix = `${orgId}/${formId}/`;
  const paths = [...new Set(picked.map((f) => f.path))].filter((p) => p.startsWith(prefix));
  if (paths.length > maxFiles(q)) return { error: `"${label}" takes at most ${maxFiles(q)} file${maxFiles(q) === 1 ? "" : "s"}.` };
  if (!paths.length) return { files: [] };
  const { data: meta, error } = await createAdminClient().rpc("form_file_meta", { p_paths: paths });
  if (error) return { error: error.message };
  const stored = new Map((meta ?? []).map((m) => [m.name, m]));
  const files: FileAnswer[] = [];
  for (const path of paths) {
    const m = stored.get(path);
    const name = String(picked.find((f) => f.path === path)?.name ?? "").slice(0, 200) || path.split("/").pop()!;
    if (!m) return { error: `"${name}" didn't finish uploading — please add it again.` };
    if (m.size > maxBytes(q)) return { error: `"${name}" is over ${maxBytes(q) / 1048576} MB.` };
    if (!fileAllowed(q.file_kinds, m.mime ?? "", path.split("/").pop()!)) return { error: `"${name}" isn't an allowed file type for "${label}".` };
    files.push({ path, name, size: m.size, type: m.mime ?? "" });
  }
  return { files };
}

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

  // 1. optional weight update; birthday is required until the profile has one
  // (an admin editing someone's response isn't asked for it).
  const birthdayRaw = String(fd.get("birthday") ?? "").trim();
  const birthday = parseBirthday(birthdayRaw);
  if (birthdayRaw && !birthday) return { error: "Please enter a valid birthday." };
  if (!birthday && !opts.asAdmin) {
    const { data: p } = await supabase.from("profiles").select("birthday").eq("id", user.id).maybeSingle();
    if (!p?.birthday) return { error: "Please enter your birthday." };
  }
  const w = String(fd.get("weight_lb") ?? "").trim();
  if (w || birthday) {
    await supabase.from("profiles").update({ ...(w ? { weight_lb: Number(w) } : {}), ...(birthday ? { birthday } : {}) }).eq("id", user.id);
    expireUser(user.id);
  }

  // Sections (Google Forms-style): only what's on this respondent's path through the
  // form counts. Skipped sections' questions aren't required and aren't stored.
  const questions = (form.questions as unknown as FormQuestion[]) ?? [];
  const parts = answeredParts(questions, (qid) => fd.get(`q_${qid}`));
  if (parts.loop) return { error: "This form's sections loop back on themselves — ask an admin to fix it." };

  // 2. per-event attendance → rsvps (validate all, then one batched upsert)
  // A ride-only address typed once at the top applies to every day where the member
  // is driving or riding from "home" — a per-day address or pickup spot still wins.
  const rideAddress = String(fd.get("ride_address") ?? "").trim();
  const parsed = [];
  const skippedDays = (links ?? []).filter((l) => !parts.dayAnswered(l.event_id) && !parts.dayHidden(l.event_id)).map((l) => l.event_id);
  for (const l of links ?? []) {
    if (!parts.dayAnswered(l.event_id)) continue;
    const v = parseAttendance(fd, `ev_${l.event_id}_`);
    if (!v) return { error: "Please answer every attendance question (and pick a pickup spot if you chose On campus)." };
    if (rideAddress && (v.ride === "driver" || v.ride === "needs_ride") && !v.pickup_address && !v.pickup_location_id) v.pickup_address = rideAddress;
    parsed.push({ event_id: l.event_id, user_id: user.id, form_id: formId, ...v });
  }
  let warning: string | undefined;
  if (parsed.length) {
    const { rows: rsvpRows, notFound } = await attachPickupCoords(supabase, user.id, parsed, form.org_id);
    warning = notFoundWarning(notFound);
    const { error } = await supabase.from("rsvps").upsert(rsvpRows);
    if (error) return { error: error.message.includes("pickup_lat") ? "Run migration 0029_rsvp_pickup_coords.sql first" : error.message };
    // An admin editing someone's response doesn't change that member's profile.
    if (!opts.asAdmin) for (const r of rsvpRows) await saveDefaultPickup(supabase, user.id, fd, `ev_${r.event_id}_`, r);
  }
  // A day in a section this response skipped: drop the answer this form gave earlier, so
  // carpools and lineups don't count a stale "yes".
  if (skippedDays.length)
    await supabase.from("rsvps").delete().eq("user_id", user.id).eq("form_id", formId).in("event_id", skippedDays);

  // 3. custom answers
  const answers: Record<string, Json> = {};
  for (const q of questions) {
    if (q.type === "info" || q.type === "day" || q.type === "section") continue; // nothing to answer here
    if (!parts.isAnswered(q)) continue; // in a section this response skipped
    const key = `q_${q.id}`;
    let val: Json = null;
    if (q.type === "multi_choice") val = fd.getAll(key).map(String);
    else if (q.type === "yes_no") { const s = fd.get(key); val = s === "yes" ? true : s === "no" ? false : null; }
    else if (q.type === "file_upload") {
      const r = await checkFiles(form.org_id, formId, q, String(fd.get(key) ?? ""));
      if ("error" in r) return { error: r.error };
      val = r.files;
    }
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
