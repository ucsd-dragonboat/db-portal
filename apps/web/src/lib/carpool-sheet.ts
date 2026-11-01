import { gridToSheetRequests, type SheetGrid } from "@db/carpool";
import { createAdminClient } from "@/lib/supabase/admin";
import { addTab, batchUpdate, getAccessToken, getSheetTabSizes, sheetViewUrl, tabTitle, SheetApiError } from "@/lib/google-sheets";
import { fmtWeekday } from "@/lib/format";

/** The team's carpool spreadsheet (null until linked, or before migration 0044 runs). */
export async function getCarpoolSheetLink(orgId: string): Promise<{ spreadsheetId: string; linkedBy: string | null } | null> {
  try {
    const { data } = await createAdminClient().from("carpool_sheet_links").select("spreadsheet_id, linked_by").eq("org_id", orgId).maybeSingle();
    return data ? { spreadsheetId: data.spreadsheet_id, linkedBy: data.linked_by } : null;
  } catch {
    return null;
  }
}

/** "Saturday Rides (Fall Regatta)"; " - Carpool 2" added when the day has more than one layout. */
function ridesTabTitle(startsAt: string, eventName: string, layoutName: string, layouts: number): string {
  return tabTitle(`${fmtWeekday(startsAt)} Rides (${eventName})${layouts > 1 ? ` - ${layoutName}` : ""}`);
}

/** A grid from the browser: cap its size and text so a bad request can't flood the sheet. */
function cleanGrid(grid: unknown): SheetGrid | null {
  if (!Array.isArray(grid) || grid.length > 400) return null;
  const rows = grid.map((row) => (Array.isArray(row) && row.length <= 60 ? row : null));
  if (rows.some((r) => !r)) return null;
  return (rows as unknown[][]).map((row) => row.map((c) => {
    if (!c || typeof c !== "object") return null;
    const x = c as Record<string, unknown>;
    const s = (k: string) => (typeof x[k] === "string" ? (x[k] as string).slice(0, 4000) : undefined);
    const n = (k: string, max: number) => (typeof x[k] === "number" && x[k] >= 1 ? Math.min(x[k] as number, max) : undefined);
    const hex = (k: string) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s(k) ?? "") ? s(k) : undefined);
    const align = ["left", "center", "right"].includes(s("align") ?? "") ? (s("align") as "left" | "center" | "right") : undefined;
    return {
      v: s("v"), f: x.f === true ? true : undefined, bg: hex("bg"), fg: hex("fg"), bold: x.bold === true, italic: x.italic === true,
      align, size: n("size", 36), colspan: n("colspan", 60), rowspan: n("rowspan", 400),
      box: /^[trbl]{1,4}$/.test(s("box") ?? "") ? s("box") : undefined,
    };
  }));
}

export type SheetWrite = { url: string; tab: string } | { error: string };

/** Publish path: write the layout's rides tab in the team's carpool spreadsheet — its own tab
 * from an earlier publish when it still exists, otherwise a new one. null = no sheet linked. */
export async function writeCarpoolTab(orgId: string, carpoolId: string, rawGrid: unknown): Promise<SheetWrite | null> {
  const link = await getCarpoolSheetLink(orgId);
  if (!link) return null;
  if (!link.linkedBy) return { error: "the admin who linked the carpool sheet left — link it again" };
  const grid = cleanGrid(rawGrid);
  if (!grid) return { error: "the layout was too big to write" };

  const admin = createAdminClient();
  const { data: cp } = await admin.from("carpools").select("id, name, event_id, sheet_spreadsheet_id, sheet_tab_id").eq("id", carpoolId).eq("org_id", orgId).maybeSingle();
  if (!cp) return { error: "layout not found" };
  const [{ data: event }, { count }] = await Promise.all([
    admin.from("events").select("title, starts_at, group:event_groups(name)").eq("id", cp.event_id).maybeSingle(),
    admin.from("carpools").select("id", { count: "exact", head: true }).eq("event_id", cp.event_id),
  ]);
  if (!event) return { error: "day not found" };

  try {
    const token = await getAccessToken(link.linkedBy);
    const tabs = await getSheetTabSizes(token, link.spreadsheetId);
    let tab = cp.sheet_spreadsheet_id === link.spreadsheetId && cp.sheet_tab_id != null ? tabs.find((t) => t.sheetId === cp.sheet_tab_id) : undefined;
    if (!tab) {
      const eventName = (event.group as { name: string } | null)?.name ?? event.title;
      const made = await addTab(token, link.spreadsheetId, ridesTabTitle(event.starts_at, eventName, cp.name, count ?? 1));
      tab = { ...made, rowCount: 1000, columnCount: 26 }; // a new tab's default size
      await admin.from("carpools").update({ sheet_spreadsheet_id: link.spreadsheetId, sheet_tab_id: made.sheetId }).eq("id", cp.id);
    }
    await batchUpdate(token, link.spreadsheetId, gridToSheetRequests(grid, tab));
    return { url: sheetViewUrl(link.spreadsheetId, tab.sheetId), tab: tab.title };
  } catch (e) {
    console.error("[carpool-sheet]", carpoolId, e);
    if (e instanceof Error && e.message === "google_unlinked") return { error: "the linked Google account needs reconnecting" };
    if (e instanceof SheetApiError && (e.status === 403 || e.status === 404)) return { error: "couldn't open the carpool sheet — check it still exists and is shared" };
    return { error: "couldn't reach Google Sheets" };
  }
}
