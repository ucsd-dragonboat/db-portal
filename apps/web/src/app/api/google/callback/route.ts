import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { safeNext } from "@/lib/email-signin";
import { googleClientEnv, saveGoogleConnection } from "@/lib/google-sheets";

/** Google OAuth redirect target: verifies state, exchanges the code, stores the refresh token. */
export async function GET(request: NextRequest) {
  const { userId } = await requireAdmin();
  const { searchParams, origin } = new URL(request.url);

  let stored: { nonce?: string; next?: string } = {};
  try { stored = JSON.parse(request.cookies.get("g_oauth")?.value ?? "{}"); } catch {}
  const next = safeNext(stored.next);
  const fail = () => {
    const res = NextResponse.redirect(`${origin}${next}?google=error`);
    res.cookies.delete("g_oauth");
    return res;
  };

  const code = searchParams.get("code");
  if (!code || searchParams.get("error") || !stored.nonce || searchParams.get("state") !== stored.nonce) return fail();

  const { id, secret } = googleClientEnv();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: `${origin}/api/google/callback`, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tok.refresh_token || !tok.access_token || !tok.id_token) return fail();

  // Email from the id_token payload — fetched directly from Google over TLS, no signature check needed.
  let email = "";
  try { email = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString()).email ?? ""; } catch {}
  if (!email) return fail();

  await saveGoogleConnection(userId, {
    googleEmail: email,
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    accessExpiresAt: new Date(Date.now() + (Number(tok.expires_in ?? 3600) - 60) * 1000).toISOString(),
  });
  const res = NextResponse.redirect(`${origin}${next}?google=connected`);
  res.cookies.delete("g_oauth");
  return res;
}
