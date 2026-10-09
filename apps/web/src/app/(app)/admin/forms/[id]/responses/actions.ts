"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, listSpreadsheets, parseSheetUrl, setDefaultSpreadsheet } from "@/lib/google-sheets";
import { linkFormToSheet, syncFormToSheet, SheetApiError } from "@/lib/sheet-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveResponse, type SubmitState } from "@/lib/save-response";

export type LinkState = { error?: string } | null;
export type DriveSearch =
  | { sheets: { id: string; name: string; modifiedTime: string }[] }
  | { error: "reconnect" | "unavailable" };

/** Browse/search the connected admin's Drive for spreadsheets (dialog picker). */
export async function searchSheets(query: string): Promise<DriveSearch> {
  const { userId } = await requireAdmin();
  try {
    const token = await getAccessToken(userId);
    return { sheets: await listSpreadsheets(token, String(query).slice(0, 100)) };
  } catch (e) {
    // 403 = token predates the Drive scope; expired grant also needs a fresh connect.
    if (e instanceof SheetApiError && e.status === 403) return { error: "reconnect" };
    if (e instanceof Error && e.message === "google_unlinked") return { error: "reconnect" };
    return { error: "unavailable" };
  }
}

/** Link a form to a pasted Google Sheet URL; claims a tab and backfills existing responses. */
export async function linkSheet(_prev: LinkState, fd: FormData): Promise<LinkState> {
  const { org, userId } = await requireAdmin();
  const formId = String(fd.get("form_id"));
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("*").eq("id", formId).eq("org_id", org.id).maybeSingle();
  if (!form) return { error: "Form not found." };

  const parsed = parseSheetUrl(String(fd.get("url") ?? ""));
  if (!parsed) return { error: "That doesn't look like a Google Sheet URL." };

  let tabId: number;
  try {
    ({ tabId } = await linkFormToSheet(form, userId, parsed.spreadsheetId));
  } catch (e) {
    if (e instanceof Error && e.message === "google_unlinked") return { error: "Your Google connection expired — reconnect and try again." };
    if (e instanceof SheetApiError && (e.status === 403 || e.status === 404)) return { error: "Couldn't open that sheet with your Google account — check the link and sharing." };
    return { error: "Couldn't reach Google Sheets — try again." };
  }

  const { error } = await supabase.from("forms")
    .update({ sheet_spreadsheet_id: parsed.spreadsheetId, sheet_tab_id: tabId, sheet_linked_by: userId })
    .eq("id", formId).eq("org_id", org.id);
  if (error) return { error: error.message };
  if (fd.get("default")) await setDefaultSpreadsheet(userId, parsed.spreadsheetId);

  await syncFormToSheet(formId); // initial backfill — admin is watching, worth the couple seconds
  revalidatePath(`/admin/forms/${formId}/responses`);
  return null;
}

/** Rewrite the linked sheet from scratch, on demand. The sync otherwise only runs
 * when someone submits a response, so a form nobody is filling in any more keeps
 * whatever its tab last received (e.g. the old "Submitted" date format). */
export async function resyncSheet(fd: FormData): Promise<void> {
  const { org } = await requireAdmin();
  const formId = String(fd.get("form_id"));
  const supabase = await createClient();
  // Confirm the form is this org's before touching anything in Google.
  const { data: form } = await supabase.from("forms").select("id").eq("id", formId).eq("org_id", org.id).maybeSingle();
  if (!form) return;
  await syncFormToSheet(formId); // full-grid rewrite; admin is watching, so not deferred
  revalidatePath(`/admin/forms/${formId}/responses`);
}

export async function unlinkSheet(fd: FormData): Promise<void> {
  const { org } = await requireAdmin();
  const formId = String(fd.get("form_id"));
  const supabase = await createClient();
  await supabase.from("forms")
    .update({ sheet_spreadsheet_id: null, sheet_tab_id: null, sheet_linked_by: null })
    .eq("id", formId).eq("org_id", org.id);
  revalidatePath(`/admin/forms/${formId}/responses`);
}

/** An admin saving (or entering) a member's response from the Responses tab. Members
 * can only write their own response, so after checking the form and the member both
 * belong to this admin's team it saves with the service-role client. */
export async function saveResponseAsAdmin(_: SubmitState, fd: FormData): Promise<SubmitState> {
  const { org } = await requireAdmin();
  const memberId = String(fd.get("as_user") ?? "");
  const formId = String(fd.get("form_id") ?? "");
  const admin = createAdminClient();
  const [{ data: form }, { data: member }] = await Promise.all([
    admin.from("forms").select("id").eq("id", formId).eq("org_id", org.id).maybeSingle(),
    admin.from("memberships").select("user_id").eq("org_id", org.id).eq("user_id", memberId).maybeSingle(),
  ]);
  if (!form || !member) return { error: "That member or form isn't on your team." };
  return saveResponse(admin, memberId, fd, { asAdmin: true });
}

/** An admin deleting a member's response. With clear_attendance on (the default), the
 * attendance they gave for this form's days goes too — otherwise they'd still count
 * as coming in lineups and carpools. */
export async function deleteResponseAsAdmin(fd: FormData) {
  const { org } = await requireAdmin();
  const memberId = String(fd.get("as_user") ?? "");
  const formId = String(fd.get("form_id") ?? "");
  const admin = createAdminClient();
  const { data: form } = await admin.from("forms").select("id, sheet_spreadsheet_id").eq("id", formId).eq("org_id", org.id).maybeSingle();
  if (!form) return;
  await admin.from("form_responses").delete().eq("form_id", formId).eq("user_id", memberId);
  if (fd.get("clear_attendance") === "on") {
    const { data: links } = await admin.from("form_events").select("event_id").eq("form_id", formId);
    const days = (links ?? []).map((l) => l.event_id);
    if (days.length) await admin.from("rsvps").delete().eq("user_id", memberId).in("event_id", days);
    for (const d of days) revalidatePath(`/events/${d}`);
    revalidatePath("/events"); revalidatePath("/admin/carpool"); revalidatePath("/admin/lineups");
  }
  if (form.sheet_spreadsheet_id) after(() => syncFormToSheet(formId));
  revalidatePath(`/admin/forms/${formId}/responses`); revalidatePath(`/forms/${formId}`); revalidatePath("/forms");
  redirect(`/admin/forms/${formId}/responses`);
}
