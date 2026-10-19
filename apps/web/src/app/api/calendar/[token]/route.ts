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
  const admin = createAdminClient();
  const [{ data: events, error }, { data: members }] = await Promise.all([
    admin.from("events")
      .select("id, kind, title, starts_at, ends_at, location_name, rsvp_deadline, created_at, group:event_groups(name)")
      .eq("org_id", owner.orgId)
      .gte("starts_at", since)
      .order("starts_at"),
    admin.from("memberships").select("user_id, profile:profiles(full_name, birthday)").eq("org_id", owner.orgId),
  ]);
  if (error) return new Response("error", { status: 500 });
  // Teammates' birthdays (migration 0034), month and day only.
  const birthdays = (members ?? []).flatMap((m) => {
    const p = m.profile as unknown as { full_name: string | null; birthday: string | null } | null;
    return p?.birthday ? [{ userId: m.user_id, name: p.full_name?.trim() || "Teammate", md: p.birthday.slice(5, 10) }] : [];
  });

  const origin = new URL(req.url).origin;
  const slug = owner.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
  // Day rows carry auto-generated titles ("Saturday 9/12") — prefer the group's real name.
  const named = (events ?? []).map((e) => ({ ...e, title: (e.group as unknown as { name: string } | null)?.name ?? e.title }));
  return new Response(buildIcs({ name: `${owner.orgName} events`, origin, events: named, birthdays }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
    },
  });
}
