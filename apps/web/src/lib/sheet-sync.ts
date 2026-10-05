import { createAdminClient } from "@/lib/supabase/admin";
import { buildResponseGrid } from "@/lib/response-grid";
import { fetchResponseGridInput } from "@/lib/response-data";
import { addTab, getAccessToken, getSheetTabs, tabTitle, writeGrid, SheetApiError } from "@/lib/google-sheets";
import type { Form } from "@/lib/database.types";

/** Full-grid rewrite of the form's linked Google Sheet tab. Never throws — logs and returns. */
export async function syncFormToSheet(formId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: form } = await admin.from("forms").select("*").eq("id", formId).maybeSingle();
    if (!form?.sheet_spreadsheet_id || !form.sheet_linked_by) return;

    const input = await fetchResponseGridInput(admin, form); // same loader the Responses page uses
    const token = await getAccessToken(form.sheet_linked_by);
    const tab = await resolveTab(token, form);
    const { header, rows } = buildResponseGrid(input);
    await writeGrid(token, form.sheet_spreadsheet_id, tab.title, [header, ...rows]);
  } catch (err) {
    console.error("[sheet-sync]", formId, err); // degraded, not fatal — next submission retries
  }
}

/** Re-sync every sheet-linked form that shows this day's attendance. Goes through
 * form_events because an RSVP made on the event page carries no form_id. */
export async function syncSheetsForEvent(eventId: string): Promise<void> {
  const { data } = await createAdminClient().from("form_events").select("form:forms(id, sheet_spreadsheet_id)").eq("event_id", eventId);
  await syncLinked((data ?? []).map((r) => r.form));
}

/** Re-sync every sheet-linked form this member is a row in — the grid only has rows for
 * members who responded, so their responses are exactly the forms that can change. */
export async function syncSheetsForMember(userId: string): Promise<void> {
  const { data } = await createAdminClient().from("form_responses").select("form:forms(id, sheet_spreadsheet_id)").eq("user_id", userId);
  await syncLinked((data ?? []).map((r) => r.form));
}

async function syncLinked(forms: ({ id: string; sheet_spreadsheet_id: string | null } | null)[]) {
  const ids = new Set(forms.filter((f) => f?.sheet_spreadsheet_id).map((f) => f!.id));
  await Promise.all([...ids].map(syncFormToSheet));
}

/** Find the form's tab by stored gid; create it (with the form's current title) when absent. */
async function resolveTab(token: string, form: Form): Promise<{ sheetId: number; title: string }> {
  const tabs = await getSheetTabs(token, form.sheet_spreadsheet_id!);
  const existing = form.sheet_tab_id != null ? tabs.find((t) => t.sheetId === form.sheet_tab_id) : undefined;
  if (existing) return existing;
  const created = await addTab(token, form.sheet_spreadsheet_id!, tabTitle(form.title));
  const admin = createAdminClient();
  await admin.from("forms").update({ sheet_tab_id: created.sheetId }).eq("id", form.id);
  return created;
}

/** Dialog path: validate access to the pasted spreadsheet and claim a tab for the form now.
 * Throws SheetApiError (403/404) or Error("google_unlinked") for the action to translate. */
export async function linkFormToSheet(form: Form, userId: string, spreadsheetId: string): Promise<{ tabId: number }> {
  const token = await getAccessToken(userId);
  const tabs = await getSheetTabs(token, spreadsheetId); // throws 403/404 when unreachable
  const existing = form.sheet_spreadsheet_id === spreadsheetId && form.sheet_tab_id != null
    ? tabs.find((t) => t.sheetId === form.sheet_tab_id) : undefined;
  if (existing) return { tabId: existing.sheetId };
  const created = await addTab(token, spreadsheetId, tabTitle(form.title));
  return { tabId: created.sheetId };
}

export { SheetApiError };
