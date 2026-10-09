"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, DEMO_VIEW_COOKIE } from "@/lib/session";
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
