import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import RaceDayView from "@/components/race-day-view";
import RichText from "@/components/rich-text";
import EventBatchForm from "@/components/event-batch-form";
import { deleteEvent, deleteGroup, renameGroup } from "@/app/(app)/admin/actions";
import ConfirmForm from "@/components/confirm-form";
import EditDay from "@/components/edit-day";
import Icon from "@/components/icon";
import { createFormForGroup } from "@/app/(app)/admin/forms/actions";
import { upgradeCarpoolData } from "@db/carpool";
import CarpoolSheetView from "@/components/carpool-sheet-view";
import type { Rsvp } from "@/lib/database.types";

/** One screen for a whole event group (e.g. a practice week): every day's attendance, lineups and rides. */
export default async function GroupOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, isAdmin } = await requireOrg();
  const supabase = await createClient();
  const [{ data: group }, { data: events }, { data: teammates }, { data: pickups }, { data: savedLocations }] = await Promise.all([
    supabase.from("event_groups").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("events").select("*").eq("group_id", id).order("starts_at"),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("pickup_locations").select("id, name").eq("org_id", org.id),
    supabase.from("saved_locations").select("*").eq("org_id", org.id).order("sort_order").order("name"),
  ]);
  if (!group) notFound();
  const eventIds = (events ?? []).map((e) => e.id);
  const [{ data: rsvps }, { data: lineups }, { data: carpools }, { data: formLinks }] = eventIds.length
    ? await Promise.all([
        supabase.from("rsvps").select("*").in("event_id", eventIds),
        supabase.from("lineups").select("*").in("event_id", eventIds).order("created_at"),
        supabase.from("carpools").select("*").in("event_id", eventIds),
        supabase.from("form_events").select("event_id, form:forms(id, title, status, due_at)").in("event_id", eventIds),
      ])
    : [{ data: [] as Rsvp[] }, { data: [] }, { data: [] }, { data: [] }];
  // Forms covering any day of this group (members only see non-draft ones — RLS handles that).
  const formsById = new Map<string, { id: string; title: string; status: string; due_at: string | null; days: number }>();
  for (const l of formLinks ?? []) {
    const f = l.form as unknown as { id: string; title: string; status: string; due_at: string | null } | null;
    if (!f) continue;
    const cur = formsById.get(f.id) ?? { ...f, days: 0 };
    cur.days += 1; formsById.set(f.id, cur);
  }
  const forms = [...formsById.values()];
  const names: Record<string, string> = {};
  for (const t of teammates ?? []) names[t.id] = t.full_name || t.email;
  const pickupName = new Map((pickups ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--g-grey-600)" }}>{group.kind} · {events?.length ?? 0} day{events?.length === 1 ? "" : "s"}</div>
          {isAdmin ? (
            <form action={renameGroup} className="flex items-center gap-2">
              <input type="hidden" name="id" value={group.id} />
              <input name="name" defaultValue={group.name} className="input-line text-2xl font-normal w-[28rem] max-w-full" />
              <button className="btn-text">Rename</button>
            </form>
          ) : <h1 className="text-2xl font-normal">{group.name}</h1>}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
          <form action={createFormForGroup}><input type="hidden" name="group_id" value={group.id} /><button className="btn-primary"><Icon name="form" /> Create form for this event</button></form>
          <details className="relative">
            <summary className="btn-secondary cursor-pointer list-none"><Icon name="plus" /> Add days</summary>
            <div className="absolute right-0 z-10 mt-2 w-[34rem] max-w-[90vw] rounded-lg border bg-white p-4 shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
              <EventBatchForm compact groupId={group.id} />
            </div>
          </details>
          </div>
        )}
      </div>

      {(forms.length > 0 || isAdmin) && (
        <div className="card !py-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium"><Icon name="form" /> Forms:</span>
          {forms.map((f) => (
            <Link key={f.id} href={isAdmin ? `/admin/forms/${f.id}` : `/forms/${f.id}`} className="chip chip-active">
              {f.title} · {f.status}{f.days < (events?.length ?? 0) ? ` · ${f.days}/${events?.length} days` : ""}
            </Link>
          ))}
          {!forms.length && <span style={{ color: "var(--g-grey-600)" }}>none yet</span>}
          {isAdmin && forms.map((f) => <Link key={`r-${f.id}`} href={`/admin/forms/${f.id}/responses`} className="btn-text py-0.5">responses</Link>)}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${(events?.length ?? 1) > 1 ? 340 : 480}px, 1fr))` }}>
        {events?.map((ev) => {
          const rs = (rsvps ?? []).filter((r) => r.event_id === ev.id);
          const yes = rs.filter((r) => r.status === "yes"), maybe = rs.filter((r) => r.status === "maybe"), no = rs.filter((r) => r.status === "no");
          const drivers = rs.filter((r) => r.ride === "driver"), needs = rs.filter((r) => r.ride === "needs_ride");
          const seats = drivers.reduce((a, r) => a + (r.seats ?? 0), 0);
          const evLineups = (lineups ?? []).filter((l) => l.event_id === ev.id && (isAdmin || l.published));
          const cp = (carpools ?? []).find((c) => c.event_id === ev.id && (isAdmin || c.published));
          const sheet = cp ? upgradeCarpoolData(cp.data, names) : null;
          return (
            <section key={ev.id} className="card space-y-3 !p-4">
              <header className="relative">
                {isAdmin && (
                  <div className="absolute right-0 top-0 flex items-center">
                    <EditDay event={ev} saved={savedLocations ?? []} />
                    <ConfirmForm action={deleteEvent} message={`Delete "${ev.title}" and its RSVPs, lineups and carpool? This can't be undone.`}>
                      <input type="hidden" name="id" value={ev.id} />
                      <button className="btn-danger-text py-0.5 text-xs" title="Delete this day">✕</button>
                    </ConfirmForm>
                  </div>
                )}
                <Link href={`/events/${ev.id}`} className="font-medium text-base hover:underline">{ev.title}</Link>
                <div className="text-sm" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={ev.starts_at} />{ev.ends_at && <> – <LocalTime iso={ev.ends_at} mode="time" /></>}{ev.location_name && <> · <Icon name="pin" /> {ev.location_name}</>}</div>
                {ev.notes && <RichText text={ev.notes} className="!text-xs mt-1" />}
              </header>

              <div className="rounded-lg p-3 text-sm" style={{ background: "var(--g-grey-50)" }}>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span><Icon name="yes" /> <b>{yes.length}</b> yes</span><span><Icon name="maybe" /> {maybe.length} maybe</span><span><Icon name="no" /> {no.length} no</span>
                  <span><Icon name="crown" /> {drivers.length} drivers · <Icon name="seat" /> {seats} seats</span><span><Icon name="hand" /> <b>{needs.length}</b> need rides</span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--g-blue)" }}>Who&apos;s coming</summary>
                  <ul className="mt-1 columns-2 text-xs">
                    {[...yes, ...maybe].map((r) => (
                      <li key={r.user_id}>{names[r.user_id] ?? "?"}{r.status === "maybe" && " (maybe)"}
                        {r.ride === "driver" && <> <Icon name="crown" />{r.seats ?? ""}</>}{r.ride === "needs_ride" && <> <Icon name="hand" />{r.pickup_location_id ? ` ${pickupName.get(r.pickup_location_id) ?? ""}` : r.pickup_address ? ` ${r.pickup_address}` : ""}</>}</li>
                    ))}
                    {!yes.length && !maybe.length && <li style={{ color: "var(--g-grey-600)" }}>Nobody yet.</li>}
                  </ul>
                </details>
              </div>

              <div>
                <div className="flex items-center justify-between text-sm font-medium"><span><Icon name="boat" /> Lineups</span>{isAdmin && <Link href={`/admin/lineups?event=${ev.id}`} className="btn-text -mr-3">Edit</Link>}</div>
                {!evLineups.length && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>{isAdmin ? "None yet." : "Not published yet."}</p>}
                <RaceDayView lineups={evLineups} names={names} showDraft={isAdmin} />
              </div>

              <div>
                <div className="flex items-center justify-between text-sm font-medium"><span><Icon name="car" /> Rides</span>{isAdmin && <Link href={`/admin/carpool?event=${ev.id}`} className="btn-text -mr-3">Edit</Link>}</div>
                {!cp && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>{isAdmin ? "Not set up yet." : "Not published yet."}</p>}
                {cp && isAdmin && !cp.published && <span className="chip !py-0 text-[10px]">draft</span>}
                {sheet && <CarpoolSheetView data={sheet} names={names} />}
              </div>
            </section>
          );
        })}
        {!events?.length && <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>No days in this event yet.</p>}
      </div>

      {isAdmin && (
        <form action={deleteGroup} className="flex items-center gap-3 pt-6 text-xs" style={{ color: "var(--g-grey-600)" }}>
          <input type="hidden" name="id" value={group.id} />
          <label className="flex items-center gap-1"><input type="checkbox" name="with_events" defaultChecked /> also delete its {events?.length ?? 0} day(s)</label>
          <button className="btn-danger-text">Delete event</button>
        </form>
      )}
    </div>
  );
}
