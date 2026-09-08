// Personal iCal feed: subscribe from Google Calendar ("From URL") or any
// calendar app; the token (migration 0020) identifies the member and scopes
// events to their org. Self-guarding — exempted from the auth proxy.

import { resolveCalendarToken } from "@/lib/calendar-token";
import { buildIcs } from "@/lib/ics";
import { allowRate, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32,64}$/.test(token)) return new Response("not found", { status: 404 });
  if (!(await allowRate(`ical:${await clientIp()}`, 60, 3600))) return new Response("too many requests", { status: 429 });

  const owner = await resolveCalendarToken(token);
  if (!owner) return new Response("not found", { status: 404 });

  const since = new Date(Date.now() - 90 * 86400e3).toISOString();
  const { data: events, error } = await createAdminClient()
    .from("events")
    .select("id, kind, title, starts_at, ends_at, location_name, rsvp_deadline, created_at")
    .eq("org_id", owner.orgId)
    .gte("starts_at", since)
    .order("starts_at");
  if (error) return new Response("error", { status: 500 });

  const origin = new URL(req.url).origin;
  const slug = owner.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
  return new Response(buildIcs({ name: `${owner.orgName} events`, origin, events: events ?? [] }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
    },
  });
}
