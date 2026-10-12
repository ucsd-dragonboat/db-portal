import { notFound, redirect } from "next/navigation";
import { fmtBirthday } from "@/lib/birthday";
import { loadCampusSpots, profileDefaultSpot } from "@/lib/campus-spots";
import Link from "next/link";
import { getSession, requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import type { Event, FormQuestion, Rsvp } from "@/lib/database.types";
import FillForm from "./fill-form";
import RichText from "@/components/rich-text";
import Icon from "@/components/icon";

export default async function FormFillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ join?: string; saved?: string }> }) {
  const { id } = await params;
  const { join, saved } = await searchParams;
  const supabase = await createClient();
  // Shared links carry ?join=CODE: a signed-in user who isn't on the team yet is joined here (new sign-ins join in the login action).
  if (join && !(await getSession()).membership) {
    await supabase.rpc("join_organization", { code: join });
    redirect(`/forms/${id}`);
  }
  const { org, userId, profile, isAdmin } = await requireOrg();
  const [{ data: form }, { data: links }, { data: response }, { data: pickups }] = await Promise.all([
    supabase.from("forms").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("form_events").select("*, event:events(*)").eq("form_id", id).order("sort_order"),
    supabase.from("form_responses").select("*").eq("form_id", id).eq("user_id", userId).maybeSingle(),
    loadCampusSpots(supabase, org.id).then((data) => ({ data })),
  ]);
  if (!form) notFound();
  const events = (links ?? []).map((l) => ({ prompt: l.prompt, event: l.event as unknown as Event })).filter((x) => x.event);
  const { data: rsvps } = events.length
    ? await supabase.from("rsvps").select("*").eq("user_id", userId).in("event_id", events.map((e) => e.event.id))
    : { data: [] as Rsvp[] };
  const rsvpBy = new Map((rsvps ?? []).map((r) => [r.event_id, r]));
  const overdue = form.due_at ? new Date(form.due_at) < new Date() : false;

  return (
    <div className="gf-page -m-4 md:-m-6 min-h-full p-4 md:p-8">
      <div className="mx-auto max-w-[640px] space-y-3">
        {form.status === "draft" && isAdmin && <p className="rounded bg-white/70 p-2 text-xs text-center" style={{ color: "var(--g-grey-600)" }}>Preview — this form is a draft and hidden from members. <Link href={`/admin/forms/${id}`} className="underline">Back to editor</Link></p>}
        {saved && <div className="gf-card text-sm"><Icon name="yes" /> Your response has been recorded — and this browser will remember you. Below is the full form in case you need to change anything.</div>}
        <div className="gf-header">
          <h1 className="text-[32px] leading-tight font-normal">{form.title}</h1>
          {form.description && <div className="mt-3" style={{ color: "var(--g-grey-900)" }}><RichText text={form.description} /></div>}
          <div className="mt-4 pt-3 border-t text-sm flex flex-wrap gap-x-4 gap-y-1" style={{ borderColor: "var(--g-grey-300)" }}>
            {form.due_at && <span className={overdue ? "font-medium" : ""} style={{ color: overdue ? "var(--g-red)" : "var(--g-grey-600)" }}><Icon name="due" /> Due <LocalTime iso={form.due_at} />{overdue && (form.status === "open" ? " — past due, late responses accepted" : " — past due")}</span>}
            <span style={{ color: "var(--g-grey-600)" }}>{profile.email}</span>
            <span className="gf-required">* Indicates required question</span>
          </div>
        </div>

        <div className="gf-card text-sm">
          <div className="flex items-center justify-between"><div className="font-medium text-base">Your info</div><Link href="/profile" className="btn-text -mr-3">Edit profile</Link></div>
          <p className="text-xs mb-2" style={{ color: "var(--g-grey-600)" }}>Pulled from your profile so we don’t ask every week.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span><Icon name="user" /> {profile.full_name || "(no name)"}</span><span><Icon name="phone" /> {profile.phone || "(no phone)"}</span>
            <span><Icon name="weight" /> {profile.weight_lb ? `${profile.weight_lb} lb` : "(no weight)"}</span><span><Icon name="house" /> {profile.address || "(no address)"}</span>
            <span style={profile.birthday ? undefined : { color: "var(--g-red)" }}><Icon name="party" /> {profile.birthday ? fmtBirthday(profile.birthday) : "(no birthday)"}</span>
          </div>
          {!profile.birthday && <p className="mt-2 text-xs" style={{ color: "var(--g-red)" }}>Your birthday is missing — it&apos;s required, so answer the birthday question below (or add it to your profile).</p>}
          {(!profile.weight_lb || !profile.address) && <p className="mt-2 text-xs" style={{ color: "var(--g-red)" }}>Coaches need your weight for lineups and your address for rides — please add them.</p>}
        </div>

        {form.status === "open"
          ? <FillForm formId={id} events={events} rsvpBy={Object.fromEntries(rsvpBy)} questions={(form.questions as unknown as FormQuestion[]) ?? []}
              existingAnswers={(response?.answers as Record<string, unknown> | null) ?? null} pickups={pickups ?? []} defaultSeats={profile.car_passengers} weightLb={profile.weight_lb} askWeight={form.ask_weight} askBirthday={!profile.birthday} defaultPickupId={profileDefaultSpot(profile)} campusPickup={form.campus_pickup ?? null}
              submittedAt={response?.submitted_at ?? null} />
          : <div className="gf-card text-sm" style={{ color: "var(--g-grey-600)" }}>
              {form.status === "closed" ? "This form is no longer accepting responses." : "This form isn’t open yet."}
              {response && <span> You responded <LocalTime iso={response.submitted_at} />.</span>}
            </div>}
        <p className="text-center text-xs pt-4" style={{ color: "var(--g-grey-600)" }}>{org.name} · Team Portal</p>
      </div>
    </div>
  );
}
