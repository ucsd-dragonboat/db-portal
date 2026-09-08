import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-member secrets for the personal iCal feed (/api/calendar/<token>).
// Stored in the service-role-only user_calendar_tokens table (migration 0020)
// and created lazily — never readable through member RLS.

export async function getOrCreateCalendarToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("user_calendar_tokens").select("token").eq("user_id", userId).maybeSingle();
  if (data) return data.token;
  // Race-safe: ignore a concurrent insert, then read whichever token won.
  await admin
    .from("user_calendar_tokens")
    .upsert({ user_id: userId, token: randomBytes(16).toString("hex") }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: row, error } = await admin.from("user_calendar_tokens").select("token").eq("user_id", userId).single();
  if (error) throw new Error(error.message);
  return row.token;
}

export async function regenerateCalendarToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const token = randomBytes(16).toString("hex");
  const { error } = await admin.from("user_calendar_tokens").upsert({ user_id: userId, token }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return token;
}

/** Token → owner + their (first) org, or null for unknown tokens. */
export async function resolveCalendarToken(token: string): Promise<{ userId: string; orgId: string; orgName: string } | null> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("user_calendar_tokens").select("user_id").eq("token", token).maybeSingle();
  if (!row) return null;
  const { data: m } = await admin
    .from("memberships")
    .select("org_id, organization:organizations(name)")
    .eq("user_id", row.user_id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!m) return null;
  return { userId: row.user_id, orgId: m.org_id, orgName: (m.organization as unknown as { name: string })?.name ?? "Team" };
}
