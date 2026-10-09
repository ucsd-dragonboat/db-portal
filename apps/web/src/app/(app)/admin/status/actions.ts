"use server";

import { requireAdmin } from "@/lib/session";
import { runCheck, type CheckResult } from "@/lib/status-checks";

/** One health check, by id — the page calls this once per selected check, in order. */
export async function runStatusCheck(id: string): Promise<CheckResult> {
  const { userId, org, profile } = await requireAdmin();
  if (org.is_demo) return { status: "skip", detail: "Not available in the demo.", ms: 0 };
  return runCheck(String(id), { userId, orgId: org.id, email: profile.email });
}
