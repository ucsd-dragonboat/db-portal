import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startSession } from "@/lib/email-signin";
import { clientIp } from "@/lib/rate-limit";
import { createDemoSandbox, demoEnabled } from "@/lib/demo";

/** "Start the demo": sign out of whatever this browser was signed into, create a fresh
 * sandbox, and sign in as its coach. */
export async function POST(request: NextRequest) {
  const back = (error: string) => NextResponse.redirect(new URL(`/demo?error=${error}`, request.url), 303);
  if (!(await demoEnabled())) return back("off"); // before signing anyone out
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await supabase.auth.signOut();

  const made = await createDemoSandbox(await clientIp());
  if ("error" in made) return back(made.error);
  const { error } = await startSession(made.email);
  if (error) { console.error("[demo] session", error); return back("failed"); }
  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
