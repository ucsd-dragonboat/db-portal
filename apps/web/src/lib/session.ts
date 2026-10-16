import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cachedHasPassword, cachedOrg, cachedUserRows } from "@/lib/session-cache";
import type { Membership, Organization, Profile } from "@/lib/database.types";

export type Session = {
  userId: string;
  profile: Profile;
  membership: (Membership & { organization: Organization }) | null;
  isAdmin: boolean;
  /** Set only inside a demo sandbox: when it expires, and whether the visitor (really an
   * admin) has switched to "view as member". */
  demo: { hoursLeft: number | null; viewingAsMember: boolean } | null;
};

/** Cookie for the demo banner's "View as member" switch. Only honoured in demo orgs. */
export const DEMO_VIEW_COOKIE = "demo_view";

/** Loads user + profile + first org membership. Redirects to /login if signed out. */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  // getClaims verifies the session JWT locally (with asymmetric signing keys), so no
  // round trip to Supabase Auth; proxy.ts has already refreshed the cookie.
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) redirect("/login");

  let { profile, membership } = await cachedUserRows(uid);
  // Never trust a cached "not on a team yet": joins happen in SQL functions that
  // can't expire the cache, so check live (rare — only until they join).
  if (!profile || !membership) {
    const [p, mm] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("memberships").select("*").eq("user_id", uid).order("created_at").limit(1).maybeSingle(),
    ]);
    profile = p.data; membership = mm.data;
  }
  if (!profile) redirect("/login");
  const organization = membership ? await cachedOrg(membership.org_id) : null;

  const m = membership && organization ? { ...membership, organization } : null;
  const demo = m?.organization.is_demo
    ? {
        hoursLeft: m.organization.demo_expires_at ? Math.max(0, Math.round((new Date(m.organization.demo_expires_at).getTime() - Date.now()) / 3600e3)) : null,
        viewingAsMember: (await cookies()).get(DEMO_VIEW_COOKIE)?.value === "member",
      }
    : null;
  return { userId: uid, profile, membership: m, isAdmin: m?.role === "admin" && !demo?.viewingAsMember, demo };
});

/** Like getSession, but requires an org; sends to onboarding otherwise. */
export async function requireOrg() {
  const s = await getSession();
  if (!s.membership) redirect("/onboarding");
  return { ...s, membership: s.membership, org: s.membership.organization };
}

/** Admin accounts can be signed into with just their (guessable) email, so a password is mandatory. */
export const adminHasPassword = cache(cachedHasPassword);

export async function requireAdmin() {
  const s = await requireOrg();
  if (!s.isAdmin) redirect("/dashboard");
  if (!(await adminHasPassword(s.userId))) redirect("/admin-password");
  return s;
}
