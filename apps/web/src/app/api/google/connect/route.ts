import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { safeNext } from "@/lib/email-signin";
import { googleClientEnv } from "@/lib/google-sheets";

/** Starts the Google OAuth flow for Sheets sync. Admin-only; NOT proxy-public, so a session is guaranteed. */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));
  const nonce = randomBytes(16).toString("hex");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: googleClientEnv().id,
    redirect_uri: `${origin}/api/google/callback`,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/spreadsheets",
    access_type: "offline",
    prompt: "consent", // always re-issue a refresh token
    state: nonce,
  }).toString();

  const res = NextResponse.redirect(auth);
  res.cookies.set("g_oauth", JSON.stringify({ nonce, next }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google", maxAge: 600,
  });
  return res;
}
