import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Icon from "@/components/icon";
import { demoEnabled } from "@/lib/demo";

export const metadata = { title: "Try the Team Portal" };

const ERRORS: Record<string, string> = {
  off: "The demo is turned off right now. Ask the coach to switch it on.",
  busy: "You've started a few demos already — give it an hour and try again.",
  full: "The demo is full right now. Please try again a bit later.",
  failed: "Something went wrong setting up your demo. Please try again.",
};

/** The QR code's landing page. Starting the demo is a button (a POST), not this page
 * load, so link previews and bots can't create sandboxes. */
export default async function DemoWelcomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: m } = await supabase.from("memberships").select("organization:organizations(is_demo, demo_expires_at)")
      .eq("user_id", user.id).order("created_at").limit(1).maybeSingle();
    const o = m?.organization as unknown as { is_demo: boolean; demo_expires_at: string | null } | null;
    if (o?.is_demo && o.demo_expires_at && new Date(o.demo_expires_at) > new Date()) redirect("/dashboard");
  }
  const on = await demoEnabled();
  const realUser = user && !user.email?.endsWith("@demo.invalid") ? user.email : null;

  return (
    <div className="gf-page flex min-h-screen items-center justify-center p-4">
      <div className="gf-card w-full max-w-md space-y-4 text-center">
        <div className="text-5xl" style={{ color: "var(--g-green)" }}><Icon name="dragon" /></div>
        <h1 className="text-2xl font-normal">Try the Team Portal</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
          You&apos;ll get your own private copy of a demo dragon boat team — fake teammates, practices, a race, forms, lineups and carpools —
          signed in as the coach. Click anything, change anything; it&apos;s yours, and it disappears after 24 hours.
        </p>
        {(error || !on) && <p className="text-sm" style={{ color: "var(--g-red)" }}>{ERRORS[on ? error ?? "failed" : "off"] ?? ERRORS.failed}</p>}
        {on && realUser && <p className="text-xs" style={{ color: "#b06000" }}>You&apos;re signed in as {realUser}. Starting the demo signs you out of that account on this browser.</p>}
        {on && (
          <form action="/demo/start" method="post">
            <button className="btn-purple w-full py-2 text-base">Start the demo</button>
          </form>
        )}
        <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>No sign-up. Nothing you do here touches the real team.</p>
      </div>
    </div>
  );
}
