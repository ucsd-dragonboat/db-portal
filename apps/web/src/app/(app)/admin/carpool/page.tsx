import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormQuestion, Profile, Rsvp } from "@/lib/database.types";
import { layoutMembers, upgradeCarpoolData, type Rider } from "@db/carpool";
import { riderFromRsvp } from "@/lib/riders";
import { flattenAnswer } from "@/lib/response-grid";
import { htmlToText } from "@/lib/html";
import CarpoolBuilder, { type SavedCarpool } from "./builder";
import LocalTime from "@/components/local-time";
import Icon from "@/components/icon";
import DayCardGrid from "@/components/day-cards";
import ConfirmForm from "@/components/confirm-form";
import { createCarpoolLayout, deleteCarpoolLayout } from "./actions";

export default async function AdminCarpoolPage({ searchParams }: { searchParams: Promise<{ event?: string; carpool?: string }> }) {
  const { event: eventId, carpool: carpoolParam } = await searchParams;
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { data: events } = await supabase.from("events").select("*, group:event_groups(id, name)").eq("org_id", org.id).order("starts_at", { ascending: false }).limit(60);
  const event = events?.find((p) => p.id === eventId) ?? null;

  // Home: Google Forms-style day picker (red). Selecting a day opens its carpool workspace.
  if (!event) {
    const eventIds = (events ?? []).map((e) => e.id);
    const [{ data: cps }, { data: yesRsvps }] = eventIds.length
      ? await Promise.all([
          supabase.from("carpools").select("event_id, name, published, data, sort_order, created_at").in("event_id", eventIds).order("sort_order").order("created_at"),
          supabase.from("rsvps").select("event_id").in("event_id", eventIds).eq("status", "yes"),
        ])
      : [{ data: [] }, { data: [] }];
    const cpBy = new Map<string, NonNullable<typeof cps>>();
    for (const c of cps ?? []) cpBy.set(c.event_id, [...(cpBy.get(c.event_id) ?? []), c]);
    // One section per event (its days together, newest event first); loose days last.
    type Day = NonNullable<typeof events>[number];
    const sections = new Map<string, { name: string; days: Day[] }>();
    for (const e of events ?? []) {
      const g = e.group as { id: string; name: string } | null;
      const key = g?.id ?? "";
      if (!sections.has(key)) sections.set(key, { name: g?.name ?? "Other days", days: [] });
      sections.get(key)!.days.push(e);
    }
    const ordered = [...sections.entries()].sort(([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0)).map(([, v]) => v);
    const goingBy = new Map<string, number>();
    for (const r of yesRsvps ?? []) goingBy.set(r.event_id, (goingBy.get(r.event_id) ?? 0) + 1);
    return (
      <div className="-m-4 md:-m-6 min-h-full">
        <div className="border-b px-4 py-5 md:px-8" style={{ background: "var(--g-red-soft)", borderColor: "var(--g-grey-300)" }}>
          <div className="mx-auto max-w-[1100px]">
            <h1 className="text-2xl font-normal" style={{ color: "var(--g-red)" }}><Icon name="car" /> Carpool</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--g-grey-600)" }}>Pick a day to coordinate rides — drivers and riders come from that day’s RSVPs. A day can have several layouts (e.g. a morning and an afternoon wave), each with its own people.</p>
          </div>
        </div>
        <div className="px-4 py-5 md:px-8"><div className="mx-auto max-w-[1100px] space-y-8">
          {!ordered.length && <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>No event days yet — create days under Events.</p>}
          {ordered.map((sec) => (
            <DayCardGrid key={sec.name + sec.days[0].id} heading={sec.name} hrefBase="/admin/carpool?event=" storageKey="carpool" color="var(--g-red)" soft="var(--g-red-soft)" empty=""
              days={sec.days.map((e) => {
                const layouts = cpBy.get(e.id) ?? [];
                const going = goingBy.get(e.id) ?? 0;
                const lines = layouts.map((cp) => {
                  const d = upgradeCarpoolData(cp.data, {});
                  const cars = [...d.going.onCampus, ...d.going.offCampus];
                  const seated = cars.reduce((n, c) => n + c.passengerIds.length + 1, 0);
                  return `${cp.name}: ${cars.length} car${cars.length === 1 ? "" : "s"} · ${seated} seated${cp.published ? "" : " (draft)"}`;
                });
                const published = layouts.filter((c) => c.published).length;
                return { id: e.id, title: e.title, starts_at: e.starts_at, lines: lines.length ? lines : undefined,
                  meta: `${layouts.length ? `${layouts.length} layout${layouts.length === 1 ? "" : "s"} · ${published} published` : "No rides yet"} · ${going} going`,
                  metaColor: published ? "var(--g-green)" : undefined };
              })} />
          ))}
        </div></div>
      </div>
    );
  }

  const riders: Record<string, Rider> = {}, drivers: { id: string; seats: number }[] = [], needsRide: string[] = [];
  const pickupNames: Record<string, string> = {};
  const [{ data: rs }, { data: layouts }, { data: pickups }, { data: formLinks }] = await Promise.all([
    // Yes only — a Maybe isn't attending until they change it (see lib/attendees.ts).
    supabase.from("rsvps").select("*, profile:profiles(*)").eq("event_id", event.id).eq("status", "yes"),
    supabase.from("carpools").select("*").eq("event_id", event.id).order("sort_order").order("created_at"),
    supabase.from("pickup_locations").select("*").eq("org_id", org.id),
    supabase.from("form_events").select("form:forms(id, questions)").eq("event_id", event.id),
  ]);
  // The layout being edited (?carpool=, else the first). No layouts yet → a new,
  // unsaved one that the first Save creates.
  const current = (layouts ?? []).find((l) => l.id === carpoolParam) ?? layouts?.[0] ?? null;
  const saved: SavedCarpool | null = current ? { data: current.data, published: current.published } : null;
  // Riders a sibling layout already has are left out of this one's pool entirely.
  const elsewhere = new Map<string, string>();
  for (const l of layouts ?? []) {
    if (l.id === current?.id) continue;
    for (const id of layoutMembers(upgradeCarpoolData(l.data, {}))) elsewhere.set(id, l.name);
  }
  const elsewhereNames: { name: string; layout: string }[] = [];

  const pickupBy = new Map((pickups ?? []).map((p) => [p.id, p]));
  for (const r of (rs ?? []) as (Rsvp & { profile: Profile })[]) {
    const out = riderFromRsvp(r, pickupBy); // shared with the auto-carpool cron
    if (!out) continue;
    const other = elsewhere.get(out.rider.id);
    if (other) { elsewhereNames.push({ name: out.rider.name, layout: other }); continue; }
    riders[out.rider.id] = out.rider;
    const pk = r.pickup_location_id ? pickupBy.get(r.pickup_location_id) : null;
    pickupNames[out.rider.id] = pk?.name ?? r.pickup_address ?? "";
    if (out.capacity != null) drivers.push({ id: out.rider.id, seats: out.capacity });
    if (r.ride === "needs_ride") needsRide.push(out.rider.id);
  }

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
      <div className="flex flex-wrap items-center gap-1 border-b text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
        {(layouts ?? []).map((l) => (
          <Link key={l.id} href={`/admin/carpool?event=${event.id}&carpool=${l.id}`}
            className="-mb-px rounded-t border px-3 py-1.5"
            style={l.id === current?.id ? { borderColor: "var(--g-grey-300)", borderBottomColor: "#fff", background: "#fff", color: "var(--g-red)", fontWeight: 500 } : { borderColor: "transparent", color: "var(--g-grey-600)" }}>
            {l.name}{!l.published && <span className="ml-1 text-[10px] uppercase">draft</span>}
          </Link>
        ))}
        {!layouts?.length && <span className="-mb-px rounded-t border bg-white px-3 py-1.5 font-medium" style={{ borderColor: "var(--g-grey-300)", borderBottomColor: "#fff", color: "var(--g-red)" }}>Carpool <span className="text-[10px] uppercase">new</span></span>}
        <form action={createCarpoolLayout}><input type="hidden" name="event_id" value={event.id} />
          <button className="btn-text py-1 text-xs" title="Another layout for this day, with different people"><Icon name="plus" /> New layout</button></form>
        <span className="flex-1" />
        {current && (
          <ConfirmForm action={deleteCarpoolLayout} message={`Delete the “${current.name}” layout? Its riders become free to place in another layout.`}>
            <input type="hidden" name="id" value={current.id} /><button className="btn-danger-text py-1 text-xs">Delete layout</button>
          </ConfirmForm>
        )}
      </div>
      {elsewhereNames.length > 0 && (
        <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>
          In another layout (not shown here): {elsewhereNames.map((e) => `${e.name} — ${e.layout}`).join(" · ")}
        </p>
      )}
      <CarpoolBuilder key={current?.id ?? `new:${event.id}`} eventId={event.id} carpoolId={current?.id ?? null} initialName={current?.name ?? "Carpool"}
        destination={event.location_lat != null && event.location_lon != null ? { lat: event.location_lat, lon: event.location_lon, label: event.location_name ?? event.title } : null}
        riders={riders} drivers={drivers} needsRide={needsRide} saved={saved}
        pickupNames={pickupNames} funFactQuestions={funFactQuestions} funFactAnswers={funFactAnswers} />
    </div>
  );
}
