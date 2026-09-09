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
