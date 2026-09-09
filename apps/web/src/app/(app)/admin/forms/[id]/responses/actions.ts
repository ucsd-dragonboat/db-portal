"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, listSpreadsheets, parseSheetUrl, setDefaultSpreadsheet } from "@/lib/google-sheets";
import { linkFormToSheet, syncFormToSheet, SheetApiError } from "@/lib/sheet-sync";

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

export async function unlinkSheet(fd: FormData): Promise<void> {
  const { org } = await requireAdmin();
  const formId = String(fd.get("form_id"));
  const supabase = await createClient();
  await supabase.from("forms")
    .update({ sheet_spreadsheet_id: null, sheet_tab_id: null, sheet_linked_by: null })
    .eq("id", formId).eq("org_id", org.id);
  revalidatePath(`/admin/forms/${formId}/responses`);
}
