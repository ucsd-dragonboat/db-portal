import { notFound, redirect } from "next/navigation";
import { loadCampusSpots } from "@/lib/campus-spots";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowRate, clientIp } from "@/lib/rate-limit";
import LocalTime from "@/components/local-time";
import RichText from "@/components/rich-text";
import FillForm from "@/app/(app)/forms/[id]/fill-form";
import type { Event, FormQuestion } from "@/lib/database.types";
import { submitPublicForm } from "./actions";
import Icon from "@/components/icon";

/**
 * Public (no sign-in) view of a form, reached via the shared link `/f/<id>?join=<TEAMCODE>`.
 * The join code is the gate: without the right one this 404s. Nothing else in the portal is visible.
 * Submitting creates / signs in the account for the typed email and joins them to the team.
 */
export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ join?: string }> }) {
  const { id } = await params;
  const { join } = await searchParams;
  if (!join) notFound();

  // Browser already signed in? Use the real form page (joins non-members via ?join=).
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user) redirect(`/forms/${id}?join=${encodeURIComponent(join)}`);

  const admin = createAdminClient();
  const { data: form } = await admin.from("forms").select("*, organization:organizations(name, join_code)").eq("id", id).maybeSingle();
  const org = form?.organization as unknown as { name: string; join_code: string } | null;
  if (!form || !org || org.join_code !== join.trim().toUpperCase() || form.status === "draft") {
    // Track failed link/code guesses per IP (slows enumeration; successes are never throttled).
    await allowRate(`fjoin:${await clientIp()}`, 20, 3600);
    notFound();
  }

  const [{ data: links }, { data: pickups }] = await Promise.all([
    admin.from("form_events").select("*, event:events(*)").eq("form_id", id).order("sort_order"),
    loadCampusSpots(admin, form.org_id).then((data) => ({ data })),
  ]);
  const events = (links ?? []).map((l) => ({ prompt: l.prompt, event: l.event as unknown as Event })).filter((x) => x.event);
  const overdue = form.due_at ? new Date(form.due_at) < new Date() : false;
  const grey = { color: "var(--g-grey-600)" };

  const identity = (
    <div className="gf-card space-y-3">
      <input type="hidden" name="join" value={org.join_code} />
      <div className="text-base font-normal">Your email<span className="gf-required"> *</span></div>
      <p className="text-xs" style={grey}>This is how we know who’s responding. We’ll remember you on this browser so you can skip this next time.</p>
      <input name="email" type="email" required placeholder="you@example.com" className="input-line w-2/3" />
      <div className="text-base font-normal pt-2">Your name</div>
      <p className="text-xs" style={grey}>Only needed the first time, if you haven’t been added to the roster yet.</p>
      <input name="full_name" placeholder="Full name" className="input-line w-2/3" />
    </div>
  );

  // The title card tops every page; the description only page 1 (Google Forms sections).
  const titleCard = (withDescription: boolean) => (
    <div className="gf-header">
      <h1 className="text-[32px] leading-tight font-normal">{form.title}</h1>
      {withDescription && form.description && <div className="mt-3" style={{ color: "var(--g-grey-900)" }}><RichText text={form.description} /></div>}
      <div className="mt-4 pt-3 border-t text-sm flex flex-wrap gap-x-4 gap-y-1" style={{ borderColor: "var(--g-grey-300)" }}>
        {form.due_at && <span className={overdue ? "font-medium" : ""} style={{ color: overdue ? "var(--g-red)" : "var(--g-grey-600)" }}><Icon name="due" /> Due <LocalTime iso={form.due_at} />{overdue && (form.status === "open" ? " — past due, late responses accepted" : " — past due")}</span>}
        <span style={grey}>{org.name}</span>
        <Link href={`/login?next=${encodeURIComponent(`/forms/${id}?join=${org.join_code}`)}`} className="underline" style={grey}>Sign in instead</Link>
        <span className="gf-required">* Indicates required question</span>
      </div>
    </div>
  );

  return (
    <div className="gf-page min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-[640px] space-y-3">
        {form.status === "open"
          ? <FillForm titleCard={titleCard(true)} laterTitleCard={titleCard(false)} formId={id} events={events} rsvpBy={{}} questions={(form.questions as unknown as FormQuestion[]) ?? []}
              existingAnswers={null} pickups={pickups ?? []} defaultSeats={null} weightLb={null} askWeight={form.ask_weight} askBirthday campusPickup={form.campus_pickup ?? null} submittedAt={null}
              submitAction={submitPublicForm} header={identity} />
          : <>{titleCard(true)}<div className="gf-card text-sm" style={grey}>This form is no longer accepting responses.</div></>}
        <p className="text-center text-xs pt-4" style={grey}>{org.name} · Team Portal</p>
      </div>
    </div>
  );
}
