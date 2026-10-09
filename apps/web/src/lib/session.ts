import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("memberships")
      .select("*, organization:organizations(*)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (!profile) redirect("/login");

  const m = membership as (Membership & { organization: Organization }) | null;
  const demo = m?.organization.is_demo
    ? {
        hoursLeft: m.organization.demo_expires_at ? Math.max(0, Math.round((new Date(m.organization.demo_expires_at).getTime() - Date.now()) / 3600e3)) : null,
        viewingAsMember: (await cookies()).get(DEMO_VIEW_COOKIE)?.value === "member",
      }
    : null;
  return { userId: user.id, profile, membership: m, isAdmin: m?.role === "admin" && !demo?.viewingAsMember, demo };
});

/** Like getSession, but requires an org; sends to onboarding otherwise. */
export async function requireOrg() {
  const s = await getSession();
  if (!s.membership) redirect("/onboarding");
  return { ...s, membership: s.membership, org: s.membership.organization };
}

/** Admin accounts can be signed into with just their (guessable) email, so a password is mandatory. */
export const adminHasPassword = cache(async (uid: string): Promise<boolean> => {
  const { data } = await createAdminClient().rpc("user_has_password", { uid });
  return !!data;
});

export async function requireAdmin() {
  const s = await requireOrg();
  if (!s.isAdmin) redirect("/dashboard");
  if (!(await adminHasPassword(s.userId))) redirect("/admin-password");
  return s;
}
