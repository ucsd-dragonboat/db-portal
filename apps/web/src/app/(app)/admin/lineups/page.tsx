import Link from "next/link";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { attendeesForDays } from "@/lib/attendees";
import { fmtDate } from "@/lib/format";
import Icon from "@/components/icon";
import BrowseGrid, { type BrowseItem } from "@/components/browse-grid";
import type { Event, LineupRow, Profile } from "@/lib/database.types";
import type { Lineup, Roster } from "@db/lineup";
import LineupBuilder, { type BuilderDay } from "./builder";
import type { FilingGroup } from "./file-dialog";

/** `event` is kept for the "Lineups" links on the Events, Group and Responses pages —
 * it now narrows the list to that day's event instead of opening a per-day workspace. */
type Params = { set?: string; new?: string; event?: string };

/** A lineup is built first and filed to an event's days later, so the home screen
 * lists sets grouped by event rather than making you pick a day up front. */
export default async function AdminLineupsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { org } = await requireAdmin();
  const supabase = await createClient();

  // Events available for filing: recent groups and their days.
  const [{ data: groupRows }, { data: dayRows }, { data: members }] = await Promise.all([
    supabase.from("event_groups").select("id, name").eq("org_id", org.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("events").select("id, title, starts_at, group_id").eq("org_id", org.id).order("starts_at", { ascending: false }).limit(120),
    supabase.from("memberships").select("profile:profiles(*)").eq("org_id", org.id),
  ]);
  const days = (dayRows ?? []) as Pick<Event, "id" | "title" | "starts_at" | "group_id">[];
  const attending = await attendeesForDays(supabase, days.map((d) => d.id));
  const groups: FilingGroup[] = (groupRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    days: days.filter((d) => d.group_id === g.id)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((d) => ({ id: d.id, label: fmtDate(d.starts_at), attending: (attending.get(d.id) ?? []).length })),
  }));

  const roster: Roster = {};
  for (const m of members ?? []) {
    const p = m.profile as unknown as Profile;
    if (!p) continue;
    roster[p.id] = { id: p.id, name: p.full_name || p.email, weight: p.weight_lb ?? 0,
      gender: p.gender, sidePreference: p.side_preference, canSteer: p.can_steer, canDrum: p.can_drum };
  }

  // ---- builder ---------------------------------------------------------------
  if (sp.set || sp.new) {
    const setId = sp.set ?? randomUUID();
    const { data: rows } = sp.set
      ? await supabase.from("lineups").select("*").eq("org_id", org.id).eq("set_id", sp.set).order("created_at")
      : { data: [] as LineupRow[] };
    const dayOf = new Map(days.map((d) => [d.id, d]));

    // Group the set's rows back into day tabs, in event order.
    const byDay = new Map<string | null, LineupRow[]>();
    for (const r of (rows ?? []) as LineupRow[]) {
      const list = byDay.get(r.event_id);
      if (list) list.push(r); else byDay.set(r.event_id, [r]);
    }
    const initialDays: BuilderDay[] = [...byDay.entries()]
      .sort((a, b) => (dayOf.get(a[0] ?? "")?.starts_at ?? "").localeCompare(dayOf.get(b[0] ?? "")?.starts_at ?? ""))
      .map(([eventId, rs]) => ({
        eventId,
        label: eventId ? fmtDate(dayOf.get(eventId)?.starts_at ?? "") : "Unfiled",
        boats: rs.map((r) => ({ rowId: r.id, name: r.name, division: r.division, boatLabel: r.boat_label,
          data: (r.data && (r.data as unknown as Lineup).seats ? (r.data as unknown as Lineup) : { boatType: r.boat_type, drummer: null, steer: null, seats: Array.from({ length: 10 }, () => [null, null]) }) as Lineup })),
      }));

    const filedIds = initialDays.map((d) => d.eventId).filter((x): x is string => !!x);
    const initialAttendees = Object.fromEntries(filedIds.map((id) => [id, (attending.get(id) ?? []).map((p) => p.id)]));
    const firstRow = (rows ?? [])[0] as LineupRow | undefined;
    const groupOfSet = filedIds.length ? dayOf.get(filedIds[0])?.group_id ?? null : null;

    return (
      <div className="space-y-4">
        <Link href="/admin/lineups" className="btn-text text-sm">← All lineups</Link>
        <LineupBuilder
          setId={setId}
          roster={roster}
          groups={groups}
          initialDays={initialDays}
          initialName={firstRow?.name ?? ""}
          initialPublished={!!firstRow?.published}
          initialGroupId={groupOfSet}
          initialAttendees={initialAttendees}
        />
      </div>
    );
  }

  // ---- home: sets grouped by event -------------------------------------------
  const { data: allRows } = await supabase.from("lineups")
    .select("id, name, event_id, set_id, published, created_at, updated_at").eq("org_id", org.id)
    .order("created_at", { ascending: false });

  type SetRow = { setId: string; name: string; published: boolean; boats: number; dayIds: Set<string>; created: string; updated: string };
  const sets = new Map<string, SetRow>();
  for (const r of allRows ?? []) {
    const key = r.set_id ?? r.id; // pre-migration rows stand alone
    const s = sets.get(key);
    if (s) {
      s.boats++; s.published ||= r.published;
      if (r.event_id) s.dayIds.add(r.event_id);
      if (r.updated_at > s.updated) s.updated = r.updated_at;
    } else {
      sets.set(key, { setId: key, name: r.name, published: r.published, boats: 1,
        dayIds: new Set(r.event_id ? [r.event_id] : []), created: r.created_at, updated: r.updated_at });
    }
  }

  const groupNameOf = (dayIds: Set<string>) => {
    for (const id of dayIds) {
      const gid = dayOfGroup(days, id);
      if (gid) return (groupRows ?? []).find((g) => g.id === gid)?.name ?? null;
    }
    return null;
  };
  const sections = new Map<string, { title: string; items: BrowseItem[] }>();
  for (const s of sets.values()) {
    const gname = groupNameOf(s.dayIds) ?? "Unfiled";
    const section = sections.get(gname) ?? { title: gname, items: [] };
    section.items.push({
      id: s.setId,
      href: `/admin/lineups?set=${s.setId}`,
      title: s.name || "Untitled lineup",
      lines: [`${s.boats} boat${s.boats === 1 ? "" : "s"}`, s.dayIds.size ? `${s.dayIds.size} day${s.dayIds.size === 1 ? "" : "s"}` : "not linked to an event"],
      meta: `${s.published ? "Published" : "Draft"} · ${s.boats} boat${s.boats === 1 ? "" : "s"}`,
      metaColor: s.published ? "var(--g-green)" : undefined,
      date: s.created,
      modified: s.updated,
    });
    sections.set(gname, section);
  }
  let ordered = [...sections.values()].sort((a, b) => (a.title === "Unfiled" ? -1 : b.title === "Unfiled" ? 1 : a.title.localeCompare(b.title)));
  // Arriving from an event/group/responses "Lineups" link: show just that event.
  const focusGroup = sp.event ? (groupRows ?? []).find((g) => g.id === dayOfGroup(days, sp.event!))?.name : null;
  if (focusGroup) ordered = ordered.filter((s) => s.title === focusGroup);

  return (
    <div className="-m-4 md:-m-6 min-h-full">
      <div className="border-b px-4 py-5 md:px-8" style={{ background: "var(--g-blue-soft)", borderColor: "var(--g-grey-300)" }}>
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-normal" style={{ color: "var(--g-blue)" }}><Icon name="boat" /> Lineups</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--g-grey-600)" }}>Build a lineup, then link it to an event and the days it covers.</p>
          </div>
          <Link href="/admin/lineups?new=1" className="btn-primary whitespace-nowrap"><Icon name="plus" /> New lineup</Link>
        </div>
      </div>
      <div className="space-y-6 px-4 py-5 md:px-8">
        {focusGroup && (
          <p className="mx-auto max-w-[1100px] text-sm" style={{ color: "var(--g-grey-600)" }}>
            Showing <b>{focusGroup}</b> · <Link href="/admin/lineups" className="underline">all lineups</Link>
          </p>
        )}
        {!ordered.length && (
          <p className="mx-auto max-w-[1100px] text-sm" style={{ color: "var(--g-grey-600)" }}>
            {focusGroup ? "No lineups for this event yet — start one above." : "No lineups yet — start one above."}
          </p>
        )}
        {ordered.map((s) => (
          <div key={s.title} className="mx-auto max-w-[1100px]">
            <BrowseGrid items={s.items} storageKey={`lineups-${s.title}`} color="var(--g-blue)" soft="var(--g-blue-soft)"
              heading={s.title} empty="Nothing here." thumbHeight="h-24"
              sorts={[{ key: "modified", label: "Last modified" }, { key: "date", label: "Date created" }, { key: "title", label: "Title" }]} />
          </div>
        ))}
      </div>
    </div>
  );
}

function dayOfGroup(days: Pick<Event, "id" | "group_id">[], eventId: string): string | null {
  return days.find((d) => d.id === eventId)?.group_id ?? null;
}
