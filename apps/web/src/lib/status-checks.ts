// Health checks for the admin Status page: every outside service the portal leans
// on, each runnable on its own. Server-only — checks touch tokens and keys, and only
// a short human-readable detail ever leaves here (never a secret's value).

import { MATRIX_PROVIDERS, ROUTE_PROVIDERS, buildNominatimSearchUrl, parseNominatimResult, type HttpRequest, type LatLon, type ProviderKeys } from "@db/carpool";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getSheetTabs, googleClientEnv, listSpreadsheets } from "@/lib/google-sheets";
import { getCalendarSync, listWritableCalendars } from "@/lib/google-calendar";
import type { Database } from "@/lib/database.types";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type CheckResult = { status: CheckStatus; detail: string; ms: number };
export type CheckMeta = { id: string; group: string; label: string; description: string;
  /** Has a real side effect (sends an email), so "Run all" leaves it out. */
  manualOnly?: boolean };
type Ctx = { userId: string; orgId: string; email: string };
type Check = CheckMeta & { run(ctx: Ctx): Promise<{ status: CheckStatus; detail: string }> };

const ok = (detail: string) => ({ status: "ok" as const, detail });
const warn = (detail: string) => ({ status: "warn" as const, detail });
const fail = (detail: string) => ({ status: "fail" as const, detail });
const skip = (detail: string) => ({ status: "skip" as const, detail });
const set = (name: string) => !!process.env[name];
const T = 15_000;

async function http(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": "db-portal-status", ...init.headers }, signal: AbortSignal.timeout(T), cache: "no-store" });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { res, json: json as Record<string, unknown> | null, text: text.slice(0, 200) };
}

// ---- Configuration ----

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const OPTIONAL_ENV: [string, string][] = [
  ["GOOGLE_CLIENT_ID", "Google Sheets + Calendar"], ["GOOGLE_CLIENT_SECRET", "Google Sheets + Calendar"],
  ["CRON_SECRET", "auto-carpools, deadline emails, calendar pull"], ["RESEND_API_KEY", "notification emails"], ["RESEND_FROM", "notification emails"],
  ["NEXT_PUBLIC_TZ", "team time zone (defaults to America/Los_Angeles)"],
  ["ORS_API_KEY", "routing fallback"], ["LOCATIONIQ_API_KEY", "routing fallback"], ["GEOAPIFY_API_KEY", "routing fallback"],
  ["MAPBOX_ACCESS_TOKEN", "routing fallback"], ["TOMTOM_API_KEY", "routing fallback"], ["GRAPHHOPPER_API_KEY", "routing fallback"],
];

// ---- Database ----

const TABLES: (keyof Database["public"]["Tables"])[] = [
  "profiles", "pending_members", "organizations", "memberships", "announcements", "saved_locations", "pickup_locations",
  "user_calendar_tokens", "user_google_tokens", "google_calendar_sync", "event_folders", "event_groups", "events", "forms",
  "form_events", "form_responses", "rsvps", "lineups", "carpools", "carpool_trips", "notification_prefs",
];

// ---- Google ----

const NEEDED_SCOPES: [string, string][] = [
  ["https://www.googleapis.com/auth/spreadsheets", "Sheets"],
  ["https://www.googleapis.com/auth/drive.metadata.readonly", "Drive file picker"],
  ["https://www.googleapis.com/auth/calendar", "Calendar"],
];

/** A fresh access token straight from the refresh grant — bypasses the cached one so
 * the client secret and refresh token are genuinely exercised. Never deletes the
 * stored connection (getAccessToken does that on invalid_grant; a check shouldn't). */
async function forceRefresh(userId: string): Promise<{ token: string } | { error: string; code?: string }> {
  const { data: row } = await createAdminClient().from("user_google_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!row) return { error: "You haven't connected Google (Settings → Google).", code: "unlinked" };
  const { id, secret } = googleClientEnv();
  const { res, json } = await http("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token, client_id: id, client_secret: secret }),
  });
  if (res.ok && typeof json?.access_token === "string") return { token: json.access_token };
  const code = String(json?.error ?? res.status);
  const why: Record<string, string> = {
    invalid_grant: "Google says the connection was revoked or expired — reconnect Google in Settings.",
    invalid_client: "Google rejected GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.",
    unauthorized_client: "This OAuth client isn't allowed to use refresh tokens.",
  };
  return { error: why[code] ?? `Token endpoint answered ${res.status}: ${code} ${String(json?.error_description ?? "")}`.trim(), code };
}

async function withGoogle(userId: string, fn: (token: string) => Promise<{ status: CheckStatus; detail: string }>) {
  if (!set("GOOGLE_CLIENT_ID") || !set("GOOGLE_CLIENT_SECRET")) return skip("Google client env vars aren't set.");
  const r = await forceRefresh(userId);
  if ("error" in r) return r.code === "unlinked" ? skip(r.error) : fail(r.error);
  return fn(r.token);
}

const googleStatus = (err: unknown) => {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err);
  if (status === 403) return fail(`403 from Google — the API may be disabled in the Cloud project, or the scope wasn't granted. ${msg.slice(0, 160)}`);
  if (status === 404) return fail("404 — not found, or not shared with the connected Google account.");
  if (msg === "google_unlinked") return fail("That admin's Google connection is gone — they need to reconnect.");
  return fail(msg.slice(0, 240));
};

// ---- Routing ----

/** UCSD → downtown → SDSU: three real San Diego points every provider can route. */
const SAMPLE: LatLon[] = [{ lat: 32.8801, lon: -117.234 }, { lat: 32.7157, lon: -117.1611 }, { lat: 32.7767, lon: -117.0713 }];
const KEY_ENV: Record<keyof ProviderKeys, string> = {
  ors: "ORS_API_KEY", locationiq: "LOCATIONIQ_API_KEY", geoapify: "GEOAPIFY_API_KEY",
  mapbox: "MAPBOX_ACCESS_TOKEN", tomtom: "TOMTOM_API_KEY", graphhopper: "GRAPHHOPPER_API_KEY",
};
const send = (req: HttpRequest) => http(req.url, { method: req.method, headers: req.headers, body: req.body });
const providerError = (status: number, text: string) =>
  status === 429 ? warn("429 — rate-limited right now (the chain skips it for 60 s).")
  : status === 401 || status === 403 ? fail(`${status} — the API key was rejected.`)
  : fail(`${status} ${text}`);

const routingChecks: Check[] = [
  ...ROUTE_PROVIDERS.map((p): Check => ({
    id: `route.${p.id}`, group: "Routing", label: `Route · ${p.id}`,
    description: `One 3-stop car route${p.needsKey ? ` (needs ${KEY_ENV[p.needsKey]})` : " (no key)"}${p.maxPoints ? `, ≤${p.maxPoints} points` : ""}.`,
    async run() {
      const key = p.needsKey ? process.env[KEY_ENV[p.needsKey]] : undefined;
      if (p.needsKey && !key) return skip(`${KEY_ENV[p.needsKey]} isn't set — skipped by the chain.`);
      const { res, json, text } = await send(p.request(SAMPLE, key));
      if (!res.ok) return providerError(res.status, text);
      const r = p.parse(json);
      return r ? ok(`${r.distanceKm.toFixed(1)} km, ${r.durationMin.toFixed(0)} min, ${r.geometry.coordinates.length} line points`) : fail(`200 but unreadable: ${text}`);
    },
  })),
  ...MATRIX_PROVIDERS.map((p): Check => ({
    id: `matrix.${p.id}`, group: "Routing", label: `Matrix · ${p.id}`,
    description: `3×3 drive-time matrix for auto-carpools${p.needsKey ? ` (needs ${KEY_ENV[p.needsKey]})` : " (no key)"}.`,
    async run() {
      const key = p.needsKey ? process.env[KEY_ENV[p.needsKey]] : undefined;
      if (p.needsKey && !key) return skip(`${KEY_ENV[p.needsKey]} isn't set — skipped by the chain.`);
      const { res, json, text } = await send(p.request(SAMPLE, key));
      if (!res.ok) return providerError(res.status, text);
      const m = p.parse(SAMPLE, json);
      const d = m?.distanceKm[0]?.[1], t = m?.durationMin[0]?.[1];
      return m && d != null && t != null ? ok(`UCSD → downtown: ${d.toFixed(1)} km, ${t.toFixed(0)} min`) : fail(`200 but unreadable: ${text}`);
    },
  })),
];

// ---- The registry ----

const CHECKS: Check[] = [
  {
    id: "env.required", group: "Configuration", label: "Required env vars", description: "Supabase URL, anon key and service-role key are set.",
    async run() {
      const missing = REQUIRED_ENV.filter((n) => !set(n));
      return missing.length ? fail(`Missing: ${missing.join(", ")}`) : ok("All set.");
    },
  },
  {
    id: "env.optional", group: "Configuration", label: "Optional env vars", description: "Which integrations are configured (values are never shown).",
    async run() {
      const missing = OPTIONAL_ENV.filter(([n]) => !set(n));
      const have = OPTIONAL_ENV.length - missing.length;
      if (!missing.length) return ok(`All ${have} set.`);
      return warn(`${have}/${OPTIONAL_ENV.length} set. Unset: ${missing.map(([n, what]) => `${n} (${what})`).join("; ")}`);
    },
  },

  {
    id: "db.service", group: "Database", label: "Service-role connection", description: "The server's privileged Supabase client can read.",
    async run() {
      const { count, error } = await createAdminClient().from("profiles").select("*", { count: "exact", head: true });
      return error ? fail(error.message) : ok(`${count ?? 0} profiles.`);
    },
  },
  {
    id: "db.rls", group: "Database", label: "Your session (RLS)", description: "Your own signed-in client can read your profile through row-level security.",
    async run(ctx) {
      const supabase = await createClient();
      const { data, error } = await supabase.from("profiles").select("id").eq("id", ctx.userId).maybeSingle();
      return error ? fail(error.message) : data ? ok("Read your profile.") : fail("Signed in, but RLS returned no profile row.");
    },
  },
  {
    id: "db.tables", group: "Database", label: "All tables exist", description: `Every table the app uses (${TABLES.length}) is reachable — a missing one usually means a migration wasn't run.`,
    async run() {
      const admin = createAdminClient();
      const results = await Promise.all(TABLES.map(async (t) => ({ t, error: (await admin.from(t).select("*", { head: true, count: "exact" })).error })));
      const bad = results.filter((r) => r.error);
      return bad.length ? fail(`${bad.length} unreachable: ${bad.map((b) => `${b.t} (${b.error!.message.slice(0, 60)})`).join("; ")}`) : ok(`All ${TABLES.length} tables reachable.`);
    },
  },
  {
    id: "db.auth", group: "Database", label: "Supabase Auth", description: "Auth service is healthy, and which sign-in providers are enabled.",
    async run() {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return fail("Supabase env vars missing.");
      const headers = { apikey: anon };
      const health = await http(`${url}/auth/v1/health`, { headers });
      if (!health.res.ok) return fail(`Health endpoint answered ${health.res.status}.`);
      const settings = await http(`${url}/auth/v1/settings`, { headers });
      const external = (settings.json?.external ?? {}) as Record<string, boolean>;
      const on = Object.entries(external).filter(([, v]) => v === true).map(([k]) => k);
      return ok(`Healthy. Sign-in providers on: ${on.join(", ") || "none"}.`);
    },
  },

  {
    id: "google.client", group: "Google OAuth", label: "OAuth client config", description: "Client id/secret are set and Google's OpenID discovery endpoint answers.",
    async run() {
      if (!set("GOOGLE_CLIENT_ID") || !set("GOOGLE_CLIENT_SECRET")) return fail("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set.");
      const { res } = await http("https://accounts.google.com/.well-known/openid-configuration");
      const id = process.env.GOOGLE_CLIENT_ID!;
      if (!id.endsWith(".apps.googleusercontent.com")) return warn("Client id doesn't look like a Google OAuth client id.");
      return res.ok ? ok("Configured; Google's OAuth endpoints are reachable.") : fail(`Discovery answered ${res.status}.`);
    },
  },
  {
    id: "google.connection", group: "Google OAuth", label: "Your Google connection", description: "You have a stored Google connection, and when its access token expires.",
    async run(ctx) {
      const { data, error } = await createAdminClient().from("user_google_tokens").select("google_email, access_expires_at, default_spreadsheet_id").eq("user_id", ctx.userId).maybeSingle();
      if (error) return fail(error.message);
      if (!data) return warn("Not connected — Settings → Connect Google.");
      const exp = data.access_expires_at ? new Date(data.access_expires_at) : null;
      return ok(`Connected as ${data.google_email}. Cached token ${exp && exp > new Date() ? `valid until ${exp.toLocaleTimeString("en-US")}` : "expired (refreshes on next use)"}. Default sheet: ${data.default_spreadsheet_id ? "set" : "none"}.`);
    },
  },
  {
    id: "google.refresh", group: "Google OAuth", label: "Token refresh", description: "Forces a refresh-token grant — proves the client secret and your refresh token both still work.",
    async run(ctx) {
      if (!set("GOOGLE_CLIENT_ID") || !set("GOOGLE_CLIENT_SECRET")) return skip("Google client env vars aren't set.");
      const r = await forceRefresh(ctx.userId);
      if ("error" in r) return r.code === "unlinked" ? skip(r.error) : fail(r.error);
      return ok("Google issued a fresh access token.");
    },
  },
  {
    id: "google.scopes", group: "Google OAuth", label: "Granted scopes", description: "The scopes on your token cover Sheets, the Drive file picker and Calendar.",
    run: (ctx) => withGoogle(ctx.userId, async (token) => {
      const { res, json } = await http(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
      if (!res.ok) return fail(`tokeninfo answered ${res.status}.`);
      const granted = String(json?.scope ?? "").split(" ");
      const missing = NEEDED_SCOPES.filter(([s]) => !granted.includes(s)).map(([, what]) => what);
      return missing.length ? warn(`Missing: ${missing.join(", ")} — reconnect Google to grant them.`) : ok(`All ${NEEDED_SCOPES.length} needed scopes granted.`);
    }),
  },
  {
    id: "google.userinfo", group: "Google OAuth", label: "Userinfo (OpenID)", description: "Google's userinfo endpoint returns the account the connection belongs to.",
    run: (ctx) => withGoogle(ctx.userId, async (token) => {
      const { res, json } = await http("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return fail(`userinfo answered ${res.status}.`);
      const { data } = await createAdminClient().from("user_google_tokens").select("google_email").eq("user_id", ctx.userId).maybeSingle();
      const email = String(json?.email ?? "?");
      return data && data.google_email !== email ? warn(`Google says ${email}, stored as ${data.google_email}.`) : ok(`Google account: ${email}.`);
    }),
  },
  {
    id: "google.drive", group: "Google OAuth", label: "Drive API", description: "Lists your recent spreadsheets (what the sheet picker uses).",
    run: (ctx) => withGoogle(ctx.userId, async (token) => {
      try { return ok(`${(await listSpreadsheets(token, "")).length} recent spreadsheets visible.`); } catch (e) { return googleStatus(e); }
    }),
  },
  {
    id: "google.sheets", group: "Google OAuth", label: "Sheets API", description: "Opens your default spreadsheet, if you've set one.",
    run: (ctx) => withGoogle(ctx.userId, async (token) => {
      const { data } = await createAdminClient().from("user_google_tokens").select("default_spreadsheet_id").eq("user_id", ctx.userId).maybeSingle();
      if (!data?.default_spreadsheet_id) return skip("No default spreadsheet set — the per-form check below covers linked sheets.");
      try { return ok(`Default spreadsheet opens: ${(await getSheetTabs(token, data.default_spreadsheet_id)).length} tabs.`); } catch (e) { return googleStatus(e); }
    }),
  },
  {
    id: "google.calendars", group: "Google OAuth", label: "Calendar API", description: "Lists the calendars you can write to.",
    async run(ctx) {
      if (!set("GOOGLE_CLIENT_ID")) return skip("Google client env vars aren't set.");
      try { return ok(`${(await listWritableCalendars(ctx.userId)).length} writable calendars.`); } catch (e) { return (e as Error).message === "google_unlinked" ? skip("You haven't connected Google.") : googleStatus(e); }
    },
  },
  {
    id: "google.teamCalendar", group: "Google OAuth", label: "Team calendar", description: "The linked team calendar opens with the linking admin's token (the cron pull depends on this).",
    async run(ctx) {
      const sync = await getCalendarSync(ctx.orgId).catch(() => null);
      if (!sync) return skip("No team calendar linked.");
      try {
        const token = await getAccessToken(sync.user_id);
        const { res, json } = await http(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(sync.calendar_id)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return googleStatus({ status: res.status, message: `calendar ${res.status}` });
        return ok(`“${String(json?.summary ?? sync.calendar_id)}” opens. Incremental sync token: ${sync.sync_token ? "present" : "missing (next pull does a full sync)"}.`);
      } catch (e) { return googleStatus(e); }
    },
  },
  {
    id: "google.linkedSheets", group: "Google OAuth", label: "Form → sheet links", description: "Every form linked to a Google Sheet can open its sheet and tab with the linking admin's token.",
    async run(ctx) {
      const { data: forms, error } = await createAdminClient().from("forms").select("title, sheet_spreadsheet_id, sheet_tab_id, sheet_linked_by").eq("org_id", ctx.orgId).not("sheet_spreadsheet_id", "is", null);
      if (error) return fail(error.message);
      if (!forms?.length) return skip("No forms are linked to a sheet.");
      const bad: string[] = [];
      for (const f of forms) {
        try {
          if (!f.sheet_linked_by) { bad.push(`${f.title}: no linking admin`); continue; }
          const tabs = await getSheetTabs(await getAccessToken(f.sheet_linked_by), f.sheet_spreadsheet_id!);
          if (f.sheet_tab_id != null && !tabs.some((t) => t.sheetId === f.sheet_tab_id)) bad.push(`${f.title}: tab was deleted (re-created on next sync)`);
        } catch (e) { bad.push(`${f.title}: ${googleStatus(e).detail.slice(0, 80)}`); }
      }
      if (!bad.length) return ok(`All ${forms.length} linked sheets open.`);
      return (bad.length === forms.length ? fail : warn)(`${forms.length - bad.length}/${forms.length} OK. ${bad.join("; ")}`);
    },
  },

  {
    id: "email.key", group: "Email", label: "Resend API key", description: "Resend accepts the key, and the From address's domain is verified.",
    async run() {
      const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
      if (!key) return skip("RESEND_API_KEY isn't set — notification emails are off.");
      const { res, json } = await http("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401 && String(json?.name) === "restricted_api_key") return ok("Key valid (sending-only, so domains can't be listed).");
      if (!res.ok) return fail(`Resend answered ${res.status}: ${String(json?.message ?? "")}`);
      const domains = ((json?.data ?? []) as { name: string; status: string }[]);
      const fromDomain = from?.match(/@([^>\s]+)/)?.[1];
      const d = domains.find((x) => x.name === fromDomain);
      if (!from) return warn("Key valid, but RESEND_FROM isn't set.");
      if (!d) return warn(`Key valid, but ${fromDomain ?? "the From domain"} isn't one of your Resend domains (${domains.map((x) => x.name).join(", ") || "none"}).`);
      return d.status === "verified" ? ok(`Key valid; ${d.name} is verified.`) : warn(`${d.name} is “${d.status}”, not verified.`);
    },
  },
  {
    id: "email.send", group: "Email", label: "Send a test email to me", manualOnly: true, description: "Actually sends one email to your own address through Resend.",
    async run(ctx) {
      const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
      if (!key || !from) return skip("RESEND_API_KEY / RESEND_FROM aren't set.");
      const { res, json } = await http("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [ctx.email], subject: "Portal status check", html: "<p>This is a test email from the admin Status page. If you got it, notification emails work.</p>" }),
      });
      return res.ok ? ok(`Sent to ${ctx.email} (id ${String(json?.id ?? "?")}).`) : fail(`Resend answered ${res.status}: ${String(json?.message ?? "")}`);
    },
  },

  ...routingChecks,
  {
    id: "geocode.nominatim", group: "Maps", label: "Geocoding · Nominatim", description: "Looks up an address (used when a member saves a new home address).",
    async run() {
      const { res, json, text } = await http(buildNominatimSearchUrl("9500 Gilman Dr, La Jolla, CA 92093"), { headers: { "User-Agent": "db-team-portal (contact via app admin)" } });
      if (!res.ok) return providerError(res.status, text);
      const loc = parseNominatimResult(json);
      return loc ? ok(`UCSD → ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`) : fail("No result for a known address.");
    },
  },
  {
    id: "tiles.openfreemap", group: "Maps", label: "Map tiles · OpenFreeMap", description: "The carpool map's tile style loads.",
    async run() {
      const { res } = await http("https://tiles.openfreemap.org/styles/liberty");
      return res.ok ? ok("Style loads.") : fail(`Answered ${res.status}.`);
    },
  },
];

export const CHECK_LIST: CheckMeta[] = CHECKS.map(({ id, group, label, description, manualOnly }) => ({ id, group, label, description, manualOnly }));

export async function runCheck(id: string, ctx: Ctx): Promise<CheckResult> {
  const check = CHECKS.find((c) => c.id === id);
  if (!check) return { status: "fail", detail: "Unknown check.", ms: 0 };
  const t0 = Date.now();
  try {
    const r = await check.run(ctx);
    return { ...r, detail: r.detail.slice(0, 600), ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? `Timed out after ${T / 1000}s.` : e.message) : String(e);
    return { status: "fail", detail: msg.slice(0, 600), ms: Date.now() - t0 };
  }
}
