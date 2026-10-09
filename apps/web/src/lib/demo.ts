// Demo sandboxes (migration 0032): a QR-code visitor gets their own throwaway team,
// seeded with fake members, as its admin. Server-only.

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowRate } from "@/lib/rate-limit";

/** Fake accounts (visitors and their teammates) all use this unroutable domain, which
 * is also how emails to them are dropped and how cleanup finds them. */
export const DEMO_EMAIL_DOMAIN = "demo.invalid";
const MAX_LIVE_SANDBOXES = 150;

/** The Team settings on/off switch (migration 0033). Off when unset or unreadable, so
 * nobody can start a demo until an admin turns it on. */
export async function demoEnabled(): Promise<boolean> {
  const { data } = await createAdminClient().from("site_settings").select("demo_enabled").maybeSingle();
  return !!data?.demo_enabled;
}

export type DemoStart = { ok: true; email: string; orgId: string } | { error: "off" | "busy" | "full" | "failed" };

/** Creates a visitor account + their seeded sandbox. Rate-limited per IP and capped
 * globally so a QR code can't be used to fill the database. */
export async function createDemoSandbox(ip: string): Promise<DemoStart> {
  if (!(await demoEnabled())) return { error: "off" };
  if (!(await allowRate(`demo-create:${ip}`, 3, 3600))) return { error: "busy" };
  const admin = createAdminClient();
  const { count } = await admin.from("organizations").select("id", { count: "exact", head: true })
    .eq("is_demo", true).gt("demo_expires_at", new Date().toISOString());
  if ((count ?? 0) >= MAX_LIVE_SANDBOXES) return { error: "full" };

  const email = `demo-${randomBytes(6).toString("hex")}@${DEMO_EMAIL_DOMAIN}`;
  // A random password satisfies the admin-password gate; nobody ever types it.
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: randomBytes(24).toString("base64url"), email_confirm: true,
    user_metadata: { full_name: "Demo Coach" },
  });
  if (error || !created.user) { console.error("[demo] createUser", error?.message); return { error: "failed" }; }
  const { data: orgId, error: seedErr } = await admin.rpc("create_demo_sandbox", { visitor: created.user.id });
  if (seedErr || !orgId) {
    console.error("[demo] seed", seedErr?.message);
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "failed" };
  }
  return { ok: true, email, orgId };
}

/** "Start over": a fresh sandbox for the same visitor, then the old one is deleted. */
export async function resetDemoSandbox(visitorId: string, oldOrgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: orgId, error } = await admin.rpc("create_demo_sandbox", { visitor: visitorId });
  if (error || !orgId) { console.error("[demo] reset", error?.message); return false; }
  await admin.rpc("cleanup_demo_sandboxes", { only_org: oldOrgId });
  return true;
}

// ---- Geo budget: demo orgs get ~10% of each free allowance ----

/** Calls per day the whole demo may make to each service (≈10% of its free quota; the
 * keyless public servers publish no quota, so they get a modest fixed share). */
export const DEMO_GEO_BUDGET: Record<string, number> = {
  osrm: 300, "fossgis-osrm": 300, "fossgis-valhalla": 300,
  ors: 200, locationiq: 500, geoapify: 300, mapbox: 330, tomtom: 66, graphhopper: 50,
  nominatim: 200,
};
/** And per sandbox per day, so one visitor can't spend everyone's share. */
const PER_SANDBOX_DAILY = 40;

const demoCache = new Map<string, { demo: boolean; at: number }>();
/** Is this org a demo sandbox? Cached briefly per server instance. */
export async function isDemoOrg(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  const hit = demoCache.get(orgId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.demo;
  const { data } = await createAdminClient().from("organizations").select("is_demo").eq("id", orgId).maybeSingle();
  const demo = !!data?.is_demo;
  demoCache.set(orgId, { demo, at: Date.now() });
  return demo;
}

/** For a demo org, whether one more call to `provider` fits today's budget (counts it if
 * so). Real teams are never limited. */
export async function demoGeoAllowed(orgId: string | null | undefined, provider: string): Promise<boolean> {
  if (!(await isDemoOrg(orgId))) return true;
  const budget = DEMO_GEO_BUDGET[provider] ?? 50;
  return (await allowRate(`demo-geo-org:${orgId}`, PER_SANDBOX_DAILY, 86400))
    && (await allowRate(`demo-geo:${provider}`, budget, 86400));
}
