// Opt-in email notifications. Each function is self-contained (takes only ids
// and re-fetches what it needs via the service-role client, same shape as
// lib/google-calendar.ts's syncEventToGoogle(eventId)) so call sites — mostly
// inside after() blocks — stay one-liners. Every send is fail-soft: a missing
// RESEND_API_KEY or a Resend outage no-ops instead of breaking the action that
// triggered it (see lib/email.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmailBatch, renderEmail } from "@/lib/email";
import { fmtDateTime } from "@/lib/format";
import type { GenerateResult } from "@/lib/carpool-auto";
import type { NotificationPrefs, Profile, Rsvp } from "@/lib/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;
type Category = "event_posted" | "deadline_reminder" | "event_signup" | "form_submitted" | "carpool_auto_generated";

async function recipients(
  admin: AdminClient, orgId: string, category: Category,
  opts: { adminOnly?: boolean; excludeUserId?: string } = {},
): Promise<{ email: string; name: string }[]> {
  let adminIds: Set<string> | null = null;
  if (opts.adminOnly) {
    const { data } = await admin.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "admin");
    adminIds = new Set((data ?? []).map((m) => m.user_id));
    if (adminIds.size === 0) return [];
  }
  const { data } = await admin.from("notification_prefs").select("user_id, profile:profiles(email, full_name)")
    .eq("org_id", orgId).eq(category as keyof NotificationPrefs, true);
  return ((data ?? []) as unknown as { user_id: string; profile: Profile | null }[])
    .filter((r) => r.profile && r.user_id !== opts.excludeUserId && (!adminIds || adminIds.has(r.user_id)))
    .map((r) => ({ email: r.profile!.email, name: r.profile!.full_name || r.profile!.email }));
}

/** New event(s) posted — everyone opted in, except the admin who posted them. */
export async function notifyEventPosted(orgId: string, eventIds: string[], excludeUserId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: events } = await admin.from("events").select("title, starts_at").in("id", eventIds);
  if (!events?.length) return;
  const to = await recipients(admin, orgId, "event_posted", { excludeUserId });
  if (!to.length) return;
  const html = renderEmail("New event posted", `<ul>${events.map((e) => `<li>${e.title} — ${fmtDateTime(e.starts_at)}</li>`).join("")}</ul>`);
  const subject = events.length > 1 ? "New events posted" : `New event: ${events[0].title}`;
  await sendEmailBatch(to.map((r) => ({ to: r.email, subject, html })));
}

/** RSVP deadline ~24h away. Stamps deadline_reminder_sent_at regardless of recipient
 * count, so the cron sweep that calls this never re-processes the same event. */
export async function notifyEventDeadline(event: { id: string; org_id: string; title: string; rsvp_deadline: string | null }): Promise<void> {
  const admin = createAdminClient();
  if (event.rsvp_deadline) {
    const to = await recipients(admin, event.org_id, "deadline_reminder");
    if (to.length) {
      const html = renderEmail("RSVP deadline approaching", `<p>The RSVP deadline for <strong>${event.title}</strong> is ${fmtDateTime(event.rsvp_deadline)} — about 24 hours from now.</p>`);
      await sendEmailBatch(to.map((r) => ({ to: r.email, subject: `RSVP deadline soon: ${event.title}`, html })));
    }
  }
  await admin.from("events").update({ deadline_reminder_sent_at: new Date().toISOString() }).eq("id", event.id);
}

/** Form deadline ~24h away. Same once-only stamping as notifyEventDeadline. */
export async function notifyFormDeadline(form: { id: string; org_id: string; title: string; due_at: string | null }): Promise<void> {
  const admin = createAdminClient();
  if (form.due_at) {
    const to = await recipients(admin, form.org_id, "deadline_reminder");
    if (to.length) {
      const html = renderEmail("Form deadline approaching", `<p>The deadline for <strong>${form.title}</strong> is ${fmtDateTime(form.due_at)} — about 24 hours from now.</p>`);
      await sendEmailBatch(to.map((r) => ({ to: r.email, subject: `Form deadline soon: ${form.title}`, html })));
    }
  }
  await admin.from("forms").update({ deadline_reminder_sent_at: new Date().toISOString() }).eq("id", form.id);
}

/** Someone RSVP'd — admins only. */
export async function notifyEventSignup(eventId: string, userId: string, status: Rsvp["status"], ride: Rsvp["ride"]): Promise<void> {
  const admin = createAdminClient();
  const [{ data: event }, { data: profile }] = await Promise.all([
    admin.from("events").select("org_id, title").eq("id", eventId).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
  ]);
  if (!event || !profile) return;
  const to = await recipients(admin, event.org_id, "event_signup", { adminOnly: true, excludeUserId: userId });
  if (!to.length) return;
  const label = status === "no" ? "won't be attending"
    : status === "maybe" ? "might attend"
    : ride === "driver" ? "is attending and driving"
    : ride === "needs_ride" ? "is attending and needs a ride"
    : "is attending";
  const who = profile.full_name || profile.email;
  const html = renderEmail("Event RSVP", `<p><strong>${who}</strong> ${label} <strong>${event.title}</strong>.</p>`);
  await sendEmailBatch(to.map((r) => ({ to: r.email, subject: `${who} RSVP'd: ${event.title}`, html })));
}

/** Someone submitted a form response — admins only. */
export async function notifyFormSubmitted(orgId: string, formId: string, userId: string, formTitle: string): Promise<void> {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const who = profile?.full_name || profile?.email || "Someone";
  const to = await recipients(admin, orgId, "form_submitted", { adminOnly: true, excludeUserId: userId });
  if (!to.length) return;
  const html = renderEmail("Form submitted", `<p><strong>${who}</strong> submitted a response to <strong>${formTitle}</strong>.</p>`);
  await sendEmailBatch(to.map((r) => ({ to: r.email, subject: `${who} submitted: ${formTitle}`, html })));
}

/** The 10-minute auto-carpool cron finished (successfully or not) for one event —
 * admins only. Routine "already started by an admin"-style skips aren't news. */
export async function notifyCarpoolAutoGenerated(orgId: string, eventId: string, result: GenerateResult): Promise<void> {
  if ("skipped" in result) return;
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("title").eq("id", eventId).maybeSingle();
  const title = event?.title ?? "an event";
  const to = await recipients(admin, orgId, "carpool_auto_generated", { adminOnly: true });
  if (!to.length) return;
  const body = "ok" in result
    ? `<p>Auto-drafted a carpool for <strong>${title}</strong>: ${result.cars} car${result.cars === 1 ? "" : "s"}, ${result.assigned} assigned, ${result.unassigned} unassigned.</p>`
    : `<p>Couldn't auto-draft a carpool for <strong>${title}</strong>: ${result.error}</p>`;
  const html = renderEmail("Auto-carpool job finished", body);
  await sendEmailBatch(to.map((r) => ({ to: r.email, subject: `Carpool auto-draft: ${title}`, html })));
}
