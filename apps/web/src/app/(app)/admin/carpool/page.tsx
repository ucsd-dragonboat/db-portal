import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion, Profile, Rsvp } from "@/lib/database.types";
import type { Rider } from "@db/carpool";
import { riderFromRsvp } from "@/lib/riders";
import { flattenAnswer } from "@/lib/response-grid";
import { htmlToText } from "@/lib/html";
import CarpoolBuilder, { type SavedCarpool } from "./builder";
import LocalTime from "@/components/local-time";
import Icon from "@/components/icon";
import DayCardGrid from "@/components/day-cards";

export default async function AdminCarpoolPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: eventId } = await searchParams;
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { data: events } = await supabase.from("events").select("*").eq("org_id", org.id).order("starts_at", { ascending: false }).limit(30);
  const event = events?.find((p) => p.id === eventId) ?? null;

  // Home: Google Forms-style day picker (red). Selecting a day opens its carpool workspace.
  if (!event) {
    const { data: cps } = (events ?? []).length
      ? await supabase.from("carpools").select("event_id, published").in("event_id", (events ?? []).map((e) => e.id))
      : { data: [] };
    const cpBy = new Map((cps ?? []).map((c) => [c.event_id, c]));
    return (
      <div className="-m-4 md:-m-6 min-h-full">
        <div className="border-b px-4 py-5 md:px-8" style={{ background: "var(--g-red-soft)", borderColor: "var(--g-grey-300)" }}>
          <div className="mx-auto max-w-[1100px]">
            <h1 className="text-2xl font-normal" style={{ color: "var(--g-red)" }}><Icon name="car" /> Carpool</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--g-grey-600)" }}>Pick a day to coordinate rides — drivers and riders come from that day’s RSVPs.</p>
          </div>
        </div>
        <div className="px-4 py-5 md:px-8"><div className="mx-auto max-w-[1100px]">
          <h2 className="mb-3 text-base">Days</h2>
          <DayCardGrid hrefBase="/admin/carpool?event=" color="var(--g-red)" soft="var(--g-red-soft)" empty="No event days yet — create days under Events."
            days={(events ?? []).map((e) => {
              const cp = cpBy.get(e.id);
              return { id: e.id, title: e.title, starts_at: e.starts_at,
                meta: cp ? (cp.published ? "rides published" : "rides drafted") : "no rides yet",
                metaColor: cp?.published ? "var(--g-green)" : undefined };
            })} />
        </div></div>
      </div>
    );
  }

  const riders: Record<string, Rider> = {}, drivers: { id: string; seats: number }[] = [], needsRide: string[] = [];
  const pickupNames: Record<string, string> = {};
  let saved: SavedCarpool | null = null;
  const [{ data: rs }, { data: cp }, { data: pickups }, { data: formLinks }] = await Promise.all([
    supabase.from("rsvps").select("*, profile:profiles(*)").eq("event_id", event.id).in("status", ["yes", "maybe"]),
    supabase.from("carpools").select("*").eq("event_id", event.id).maybeSingle(),
    supabase.from("pickup_locations").select("*").eq("org_id", org.id),
    supabase.from("form_events").select("form:forms(id, questions)").eq("event_id", event.id),
  ]);
  const pickupBy = new Map((pickups ?? []).map((p) => [p.id, p]));
  for (const r of (rs ?? []) as (Rsvp & { profile: Profile })[]) {
    const out = riderFromRsvp(r, pickupBy); // shared with the auto-carpool cron
    if (!out) continue;
    riders[out.rider.id] = out.rider;
    const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
    pickupNames[out.rider.id] = pk?.name ?? r.pickup_address ?? "";
    if (out.capacity != null) drivers.push({ id: out.rider.id, seats: out.capacity });
    if (r.ride === "needs_ride") needsRide.push(out.rider.id);
  }
  if (cp) saved = { data: cp.data, published: cp.published };

  // Fun-fact panel: answerable questions from the form(s) linked to this day + everyone's answers.
  const forms = (formLinks ?? []).map((l) => l.form as unknown as { id: string; questions: unknown }).filter(Boolean);
  const funFactQuestions = forms.flatMap((f) => ((f.questions as FormQuestion[]) ?? [])
    .filter((q) => q.type !== "info" && q.type !== "day")
    .map((q) => ({ id: q.id, label: htmlToText(q.label) })));
  const funFactAnswers: Record<string, { userId: string; text: string }[]> = {};
  if (forms.length) {
    const { data: responses } = await supabase.from("form_responses").select("user_id, answers").in("form_id", forms.map((f) => f.id));
    for (const q of funFactQuestions) {
      const rows = (responses ?? [])
        .map((r) => ({ userId: r.user_id, text: flattenAnswer((r.answers as Record<string, unknown> | null)?.[q.id]) }))
        .filter((r) => r.text);
      if (rows.length) funFactAnswers[q.id] = rows;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/carpool" className="btn-text -ml-3" style={{ color: "var(--g-red)" }}>← Carpool</Link>
        <h1 className="text-2xl font-normal">{event.title}</h1>
        <span className="text-sm" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={event.starts_at} /></span>
      </div>
      <CarpoolBuilder key={event.id} eventId={event.id}
        destination={event.location_lat != null && event.location_lon != null ? { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title } : null}
        riders={riders} drivers={drivers} needsRide={needsRide} saved={saved}
        pickupNames={pickupNames} funFactQuestions={funFactQuestions} funFactAnswers={funFactAnswers} />
    </div>
  );
}
