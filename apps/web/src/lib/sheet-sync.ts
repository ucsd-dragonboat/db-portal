import { createAdminClient } from "@/lib/supabase/admin";
import { buildResponseGrid, type GridEvent } from "@/lib/response-grid";
import { addTab, getAccessToken, getSheetTabs, tabTitle, writeGrid, SheetApiError } from "@/lib/google-sheets";
import type { Form, Profile } from "@/lib/database.types";

/** Full-grid rewrite of the form's linked Google Sheet tab. Never throws — logs and returns. */
export async function syncFormToSheet(formId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: form } = await admin.from("forms").select("*").eq("id", formId).maybeSingle();
    if (!form?.sheet_spreadsheet_id || !form.sheet_linked_by) return;

    const [{ data: links }, { data: responses }, { data: members }, { data: pickups }] = await Promise.all([
      admin.from("form_events").select("*, event:events(id, title, starts_at)").eq("form_id", formId).order("sort_order"),
      admin.from("form_responses").select("*").eq("form_id", formId),
      admin.from("memberships").select("profile:profiles(*)").eq("org_id", form.org_id),
      admin.from("pickup_locations").select("id, name").eq("org_id", form.org_id),
    ]);
    const events = (links ?? []).map((l) => l.event).filter(Boolean) as GridEvent[];
    const { data: rsvps } = events.length
      ? await admin.from("rsvps").select("*").in("event_id", events.map((e) => e.id))
      : { data: [] };

    const token = await getAccessToken(form.sheet_linked_by);
    const tab = await resolveTab(token, form);
    const { header, rows } = buildResponseGrid({
      form,
      events,
      profiles: (members ?? []).map((m) => m.profile as unknown as Profile).filter(Boolean),
      responses: responses ?? [],
      rsvps: rsvps ?? [],
      pickups: pickups ?? [],
    });
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
