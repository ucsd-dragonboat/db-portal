"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAccount, lookupEmail, normalizeEmail, safeNext, startSession } from "@/lib/email-signin";
import { allowRate, clientIp, RATE_LIMIT_MSG } from "@/lib/rate-limit";

export type AuthState = { error?: string; step?: "password" | "name"; email?: string; sent?: boolean };

/**
 * Email-only sign-in. Type your email and you're in — no password, no confirmation email.
 *  - Existing account → signed in. Admins who have set a password are asked for it.
 *  - Email on an admin's roster (pending_members) → account created and linked to the team.
 *  - Unknown email → asked for a name, account created, sent to onboarding (join code).
 *  - If the destination carries `?join=CODE`, the user is joined to that team first.
 */
export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(formData.get("email"));
  const next = safeNext(formData.get("next"));
  if (!email) return { error: "Email is required" };

  // Brute-force / enumeration guard: per IP and per targeted email.
  const ip = await clientIp();
  if (!(await allowRate(`signin:ip:${ip}`, 10, 600))) return { error: RATE_LIMIT_MSG };
  if (!(await allowRate(`signin:email:${email}`, 5, 900))) return { error: RATE_LIMIT_MSG };

  // "Forgot password?" on the password step: email a 30-minute reset link.
  if (formData.get("intent") === "forgot") {
    if (!(await allowRate(`pwreset:${email}`, 3, 3600))) return { step: "password", email, error: RATE_LIMIT_MSG };
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
    // Same reply whether or not the account exists — no enumeration.
    return { step: "password", email, sent: true };
  }

  const found = await lookupEmail(email);
  if (found.userId) {
    if (found.hasPassword) {
      const password = String(formData.get("password") ?? "");
      if (!password) return { step: "password", email };
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { step: "password", email, error: "Wrong password." };
      await joinFromLink(next);
      redirect(next);
    }
  } else {
    const fullName = found.pendingName || String(formData.get("full_name") ?? "").trim();
    if (!fullName) return { step: "name", email };
    const { error } = await createAccount(email, fullName);
    if (error) return { error };
  }

  const { error } = await startSession(email);
  if (error) return { error };
  await joinFromLink(next);
  redirect(next);
}

/** Links may carry ?join=CODE so newcomers land on the team without the onboarding step. */
async function joinFromLink(next: string) {
  const code = new URL(next, "http://x").searchParams.get("join");
  if (!code) return;
  const supabase = await createClient();
  await supabase.rpc("join_organization", { code }); // no-op if already a member; invalid codes just fall through to onboarding
}

export type ResetState = { error?: string };

/** Final step of password reset: the emailed link signed the user in; save the new password. */
export async function completeReset(_: ResetState, fd: FormData): Promise<ResetState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link expired — request a new one from the sign-in page." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
