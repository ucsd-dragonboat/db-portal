"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type State = { error?: string };

// Hard cap on portals (organizations). MAX_ORGS env var; defaults to 1.
const parsedCap = parseInt(process.env.MAX_ORGS ?? "", 10);
const MAX_ORGS = Number.isFinite(parsedCap) ? Math.max(0, parsedCap) : 1;

export async function createOrg(_: State, formData: FormData): Promise<State> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Team name is required" };
  // Users only see their own orgs through RLS, so count with the service role.
  const { count } = await createAdminClient()
    .from("organizations")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_ORGS)
    return { error: "This portal isn't accepting new teams. Ask your team admin for a join code instead." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { org_name: name });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function joinOrg(_: State, formData: FormData): Promise<State> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Join code is required" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_organization", { code });
  if (error) return { error: error.message.includes("invalid") ? "Invalid join code" : error.message };
  redirect("/dashboard");
}
