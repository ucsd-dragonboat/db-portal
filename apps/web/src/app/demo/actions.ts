"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin, DEMO_VIEW_COOKIE } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetDemoSandbox } from "@/lib/demo";

/** Demo banner: flip between the coach's view and a member's view of the sandbox. */
export async function toggleDemoView() {
  const s = await getSession();
  if (!s.demo) return;
  const jar = await cookies();
  if (s.demo.viewingAsMember) jar.delete(DEMO_VIEW_COOKIE);
  else jar.set(DEMO_VIEW_COOKIE, "member", { path: "/", sameSite: "lax", maxAge: 86400 });
  redirect("/dashboard");
}

/** Demo banner: throw this sandbox away and start a fresh one. */
export async function startDemoOver() {
  const s = await getSession();
  if (!s.demo || !s.membership) return;
  (await cookies()).delete(DEMO_VIEW_COOKIE);
  await resetDemoSandbox(s.userId, s.membership.org_id);
  redirect("/dashboard");
}

/** Team settings: turn the public /demo on or off for the whole site. Admins of real
 * teams only; sandboxes already running keep going until they expire. */
export async function setDemoEnabled(fd: FormData) {
  const { org } = await requireAdmin();
  if (org.is_demo) return;
  await createAdminClient().from("site_settings")
    .update({ demo_enabled: fd.get("enabled") === "1", updated_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/admin/settings");
}
