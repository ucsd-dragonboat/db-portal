"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_EMAIL_DOMAIN, deleteDemoSandbox } from "@/lib/demo";

/** Demos page: admins of real teams only (it reaches across every sandbox). */
async function requireMonitor() {
  const { org } = await requireAdmin();
  if (org.is_demo) throw new Error("Not available in a demo.");
}

/** Deletes a sandbox and signs its visitor out for good. The SQL cleanup spares users
 * younger than 2 minutes (a sandbox may be mid-build), which would leave a fresh visitor
 * signed in with no team, so the visitor is deleted here directly. */
async function endSandbox(orgId: string) {
  const admin = createAdminClient();
  const { data: o } = await admin.from("organizations").select("created_by").eq("id", orgId).eq("is_demo", true).maybeSingle();
  if (!o) return;
  await deleteDemoSandbox(orgId);
  if (!o.created_by) return;
  const { data: u } = await admin.auth.admin.getUserById(o.created_by);
  if (u.user?.email?.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) await admin.auth.admin.deleteUser(o.created_by);
}

/** Delete one sandbox now. */
export async function deleteDemo(fd: FormData) {
  await requireMonitor();
  const orgId = String(fd.get("org_id") ?? "");
  if (orgId) await endSandbox(orgId);
  revalidatePath("/admin/demos");
}

/** Delete every live sandbox (their visitors are signed out). */
export async function deleteAllDemos() {
  await requireMonitor();
  const { data } = await createAdminClient().from("organizations").select("id").eq("is_demo", true);
  for (const o of data ?? []) await endSandbox(o.id);
  revalidatePath("/admin/demos");
}

/** Set a sandbox to expire `hours` from now; the 10-minute cron deletes it after that. */
export async function setDemoExpiry(fd: FormData) {
  await requireMonitor();
  const orgId = String(fd.get("org_id") ?? "");
  const hours = Number(fd.get("hours"));
  if (!orgId || !(hours > 0 && hours <= 168)) return;
  await createAdminClient().from("organizations")
    .update({ demo_expires_at: new Date(Date.now() + hours * 3600e3).toISOString() })
    .eq("id", orgId).eq("is_demo", true);
  revalidatePath("/admin/demos");
}

/** How long new sandboxes last. */
export async function setDemoHours(fd: FormData) {
  await requireMonitor();
  const hours = Math.round(Number(fd.get("hours")));
  if (!(hours >= 1 && hours <= 168)) return;
  await createAdminClient().from("site_settings").update({ demo_hours: hours, updated_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/admin/demos");
}
