import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import LocalTime from "@/components/local-time";
import type { Event, FormQuestion, Rsvp } from "@/lib/database.types";
import FillForm from "@/app/(app)/forms/[id]/fill-form";
import { saveResponseAsAdmin } from "../actions";

/** An admin editing one member's response — the member's own form, filled with their
 * answers, saved on their behalf. Also used to enter a response for someone who
 * hasn't submitted. */
export default async function EditMemberResponsePage({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const { org } = await requireAdmin();
  // Service role: admins can't read other members' RSVP details through RLS everywhere,
  // and the checks below keep this to the admin's own team.
  const admin = createAdminClient();
  const [{ data: form }, { data: member }, { data: links }, { data: response }, { data: pickups }] = await Promise.all([
    admin.from("forms").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    admin.from("memberships").select("profile:profiles(*)").eq("org_id", org.id).eq("user_id", userId).maybeSingle(),
    admin.from("form_events").select("*, event:events(*)").eq("form_id", id).order("sort_order"),
    admin.from("form_responses").select("*").eq("form_id", id).eq("user_id", userId).maybeSingle(),
    admin.from("pickup_locations").select("*").eq("org_id", org.id).eq("active", true).order("sort_order"),
  ]);
  const profile = member?.profile as unknown as { id: string; full_name: string; email: string; car_passengers: number | null; weight_lb: number | null } | null;
  if (!form || form.status === "template" || !profile) notFound();
  const events = (links ?? []).map((l) => ({ prompt: l.prompt, event: l.event as unknown as Event })).filter((x) => x.event);
  const { data: rsvps } = events.length
    ? await admin.from("rsvps").select("*").eq("user_id", userId).in("event_id", events.map((e) => e.event.id))
    : { data: [] as Rsvp[] };
  const name = profile.full_name || profile.email;

  return (
    <div className="gf-page -m-4 md:-m-6 min-h-full p-4 md:p-8">
      <div className="mx-auto max-w-[640px] space-y-3">
        <Link href={`/admin/forms/${id}/responses`} className="btn-text -ml-3 text-sm">← Responses</Link>
        <div className="gf-header">
          <h1 className="text-[28px] leading-tight font-normal">{form.title}</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--g-grey-600)" }}>
            {response ? <>Editing <b>{name}</b>&apos;s response (submitted <LocalTime iso={response.submitted_at} />).</> : <>Entering a response for <b>{name}</b> — they haven&apos;t submitted one.</>}
            {" "}Saving updates their attendance, rides and answers{form.sheet_spreadsheet_id ? " and the linked Google Sheet" : ""}. Their submitted time and on-time/late status stay as they were.
          </p>
          {form.status !== "open" && <p className="mt-1 text-xs" style={{ color: "#b06000" }}>This form is {form.status} for members — admins can still edit.</p>}
        </div>
        <FillForm formId={id} events={events} rsvpBy={Object.fromEntries((rsvps ?? []).map((r) => [r.event_id, r]))}
          questions={(form.questions as unknown as FormQuestion[]) ?? []}
          existingAnswers={(response?.answers as Record<string, unknown> | null) ?? null} pickups={pickups ?? []}
          defaultSeats={profile.car_passengers} weightLb={profile.weight_lb} askWeight={form.ask_weight}
          submittedAt={response?.submitted_at ?? null} submitAction={saveResponseAsAdmin}
          header={<input type="hidden" name="as_user" value={userId} />}
          savedMessage={<>Saved {name}&apos;s response. <Link href={`/admin/forms/${id}/responses`} className="underline">Back to responses</Link></>} />
      </div>
    </div>
  );
}
