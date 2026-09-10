import { createAdminClient } from "@/lib/supabase/admin";

/** Google OAuth (per-admin refresh tokens, service-role-only table) + raw Sheets v4 API. */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT = 10_000;

export function googleClientEnv() {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

/** "https://docs.google.com/spreadsheets/d/<id>/edit#gid=123" → { spreadsheetId, gid } */
export function parseSheetUrl(raw: string): { spreadsheetId: string; gid: number | null } | null {
  const m = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const g = raw.match(/[#?&]gid=(\d+)/);
  return { spreadsheetId: m[1], gid: g ? Number(g[1]) : null };
}

/** Sheets tab titles: no [ ] * ? / \ : , not empty, not starting with ', max 100 chars. */
export function tabTitle(formTitle: string): string {
  const t = formTitle.replace(/[[\]*?/\\:]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+/, "").slice(0, 100).trim();
  return t || "Form";
}

export function sheetViewUrl(spreadsheetId: string, gid: number | null): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gid != null ? `#gid=${gid}` : ""}`;
}

// ---- token storage ----

export async function getGoogleConnection(userId: string): Promise<{ googleEmail: string; defaultSpreadsheetId: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("user_google_tokens").select("google_email, default_spreadsheet_id").eq("user_id", userId).maybeSingle();
  return data ? { googleEmail: data.google_email, defaultSpreadsheetId: data.default_spreadsheet_id } : null;
}

export async function saveGoogleConnection(userId: string, c: { googleEmail: string; refreshToken: string; accessToken: string; accessExpiresAt: string }) {
  const admin = createAdminClient();
  const { error } = await admin.from("user_google_tokens").upsert(
    { user_id: userId, google_email: c.googleEmail, refresh_token: c.refreshToken, access_token: c.accessToken, access_expires_at: c.accessExpiresAt },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

export async function disconnectGoogle(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("user_google_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (data) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: data.refresh_token }), signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {} // best effort — delete our copy regardless
  }
  await admin.from("user_google_tokens").delete().eq("user_id", userId);
}

export async function setDefaultSpreadsheet(userId: string, spreadsheetId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("user_google_tokens").update({ default_spreadsheet_id: spreadsheetId }).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** For new-form auto-link: the creator's default spreadsheet as forms columns, or {}. */
export async function defaultSheetColumns(userId: string): Promise<{ sheet_spreadsheet_id: string; sheet_linked_by: string } | Record<string, never>> {
  try {
    const conn = await getGoogleConnection(userId);
    return conn?.defaultSpreadsheetId ? { sheet_spreadsheet_id: conn.defaultSpreadsheetId, sheet_linked_by: userId } : {};
  } catch {
    return {}; // migration not run yet
  }
}

/** Valid access token for the user, refreshing via the stored refresh token when stale.
 * Throws Error("google_unlinked") (and deletes the row) when Google reports the grant revoked. */
export async function getAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("user_google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) throw new Error("google_unlinked");
  if (row.access_token && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 60_000) return row.access_token;

  const { id, secret } = googleClientEnv();
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token, client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error === "invalid_grant") { // revoked or expired — forget the connection
      await admin.from("user_google_tokens").delete().eq("user_id", userId);
      throw new Error("google_unlinked");
    }
    throw new Error(`google token refresh failed: ${res.status}`);
  }
  const accessToken = body.access_token as string;
  const expiresAt = new Date(Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000).toISOString();
  await admin.from("user_google_tokens").update({ access_token: accessToken, access_expires_at: expiresAt }).eq("user_id", userId);
  return accessToken;
}

// ---- Sheets API ----

export class SheetApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function sheetsFetch(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new SheetApiError(res.status, `sheets api ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Recent spreadsheets in the user's Drive (incl. shared with them), optionally filtered by name.
 * Needs the drive.metadata.readonly scope — connections made before it was added get a 403. */
export async function listSpreadsheets(token: string, query: string): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  const parts = ["mimeType='application/vnd.google-apps.spreadsheet'", "trashed=false"];
  if (query) parts.push(`name contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  const url = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
    q: parts.join(" and "), orderBy: "viewedByMeTime desc", pageSize: "12", fields: "files(id,name,modifiedTime)",
  }).toString();
  const data = await sheetsFetch(token, url);
  return data.files ?? [];
}

export async function getSheetTabs(token: string, spreadsheetId: string): Promise<{ sheetId: number; title: string }[]> {
  const data = await sheetsFetch(token, `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  return (data.sheets ?? []).map((s: { properties: { sheetId: number; title: string } }) => s.properties);
}

export async function addTab(token: string, spreadsheetId: string, title: string): Promise<{ sheetId: number; title: string }> {
  const tryAdd = async (t: string) => {
    const data = await sheetsFetch(token, `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      // index 0 = the new tab lands leftmost in the tab bar, not appended at the end.
      method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t, index: 0 } } }] }),
    });
    return data.replies[0].addSheet.properties as { sheetId: number; title: string };
  };
  try {
    return await tryAdd(title);
  } catch (e) {
    if (e instanceof SheetApiError && e.status === 400) return tryAdd(`${title.slice(0, 96)} (2)`); // title taken
    throw e;
  }
}

/** Full rewrite of a tab: clear everything, then RAW-write the grid at A1.
 * RAW is load-bearing — user answers like "=IMPORTXML(...)" must land as text, never formulas. */
export async function writeGrid(token: string, spreadsheetId: string, title: string, values: (string | number)[][]) {
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  await sheetsFetch(token, `${SHEETS_BASE}/${spreadsheetId}/values/${range}:clear`, { method: "POST", body: "{}" });
  await sheetsFetch(token, `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1`)}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values }),
  });
}
