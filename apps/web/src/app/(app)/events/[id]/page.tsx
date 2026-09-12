import { notFound } from "next/navigation";
import Icon from "@/components/icon";
import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import RsvpForm from "./rsvp-form";
import type { Rsvp } from "@/lib/database.types";
import { upgradeCarpoolData } from "@db/carpool";
import CarpoolSheetView from "@/components/carpool-sheet-view";
import RaceDayView from "@/components/race-day-view";
import RichText from "@/components/rich-text";
import ConfirmForm from "@/components/confirm-form";
import { deleteEvent } from "@/app/(app)/admin/actions";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, userId, profile, isAdmin } = await requireOrg();
  const supabase = await createClient();
  const [{ data: event }, { data: rsvps }, { data: lineups }, { data: carpool }, { data: pickups }] = await Promise.all([
    supabase.from("events").select("*, group:event_groups(id, name)").eq("id", id).maybeSingle(),
    supabase.from("rsvps").select("*, profile:profiles(full_name)").eq("event_id", id).order("updated_at"),
    supabase.from("lineups").select("*").eq("event_id", id).eq("published", true).order("created_at"),
    supabase.from("carpools").select("*").eq("event_id", id).eq("published", true).maybeSingle(),
    supabase.from("pickup_locations").select("*").eq("org_id", org.id).eq("active", true).order("sort_order"),
  ]);
  if (!event) notFound();
  // The roster is only needed to name people in published lineups/carpools — skip it otherwise.
  const { data: teammates } = (lineups?.length || carpool)
    ? await supabase.from("profiles").select("id, full_name, email")
    : { data: [] };
  const names: Record<string, string> = {};
  for (const t of teammates ?? []) names[t.id] = t.full_name || t.email;
  const sheet = carpool ? upgradeCarpoolData(carpool.data, names) : null;
  const list = (rsvps ?? []) as (Rsvp & { profile: { full_name: string } | null })[];
  const mine = list.find((r) => r.user_id === userId) ?? null;
  const by = (s: Rsvp["status"]) => list.filter((r) => r.status === s);
  const closed = event.rsvp_deadline ? new Date(event.rsvp_deadline) < new Date() : false;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        {event.group && <Link href={`/groups/${(event.group as { id: string; name: string }).id}`} className="text-xs hover:underline" style={{ color: "var(--g-blue)" }}>← {(event.group as { id: string; name: string }).name}</Link>}
        {isAdmin && (
          <ConfirmForm action={deleteEvent} message={`Delete "${event.title}" and its RSVPs, lineups and carpool?`} className="float-right">
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="redirect" value={event.group ? `/groups/${(event.group as { id: string }).id}` : "/events"} />
            <button className="btn-danger-text text-xs">Delete day</button>
          </ConfirmForm>
        )}
        <h1 className="text-2xl font-normal">{event.title} <span className="text-xs uppercase text-slate-400 font-normal">{event.kind}</span></h1>
        <p className="text-slate-600"><LocalTime iso={event.starts_at} />{event.ends_at && <> – <LocalTime iso={event.ends_at} mode="time" /></>}</p>
        {event.location_name && <p className="text-slate-600"><Icon name="pin" /> {event.location_name}</p>}
        {event.notes && <RichText text={event.notes} className="mt-3" />}
        {event.rsvp_deadline && <p className="mt-2 text-xs text-slate-500">RSVP by <LocalTime iso={event.rsvp_deadline} />{closed && " (closed)"}</p>}
        {!!lineups?.length && (
          <div className="mt-6">
            <h2 className="font-semibold mb-2">Lineups</h2>
            <RaceDayView lineups={lineups} names={names} />
          </div>
        )}
        {sheet && (
          <div className="mt-6">
            <h2 className="font-semibold mb-2">Carpool</h2>
            <CarpoolSheetView data={sheet} names={names} />
          </div>
        )}
        <div className="mt-6">
          {closed && !isAdmin ? <p className="card text-sm text-slate-600">RSVPs are closed. {mine ? `Your response: ${mine.status}` : ""}</p>
            : <RsvpForm eventId={id} existing={mine} defaultSeats={profile.car_passengers} pickups={pickups ?? []} />}
        </div>
      </section>
      <aside className="space-y-4">
        {(["yes", "maybe", "no"] as const).map((s) => (
          <div key={s} className="card">
            <h3 className="font-semibold capitalize mb-2">{s} <span className="text-slate-400 font-normal">({by(s).length})</span></h3>
            <ul className="text-sm space-y-1">
              {by(s).map((r) => (
                <li key={r.user_id} className="flex justify-between gap-2">
                  <span>{r.profile?.full_name || "Member"}</span>
                  <span className="text-xs text-slate-500">
                    {r.ride === "driver" && <><Icon name="car" /> {r.seats ?? "?"} seats</>}
                    {r.ride === "self" && "🫥 own ride"}
                    {r.ride === "needs_ride" && <><Icon name="hand" /> needs ride</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>
    </div>
  );
}
