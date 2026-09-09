import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import Icon from "@/components/icon";
import DayCardGrid from "@/components/day-cards";
import type { Roster, Lineup, BoatType } from "@db/lineup";
import type { LineupRow, Profile } from "@/lib/database.types";
import LineupBuilder from "./builder";
import RaceDaySections from "./race-day";

type Params = { event?: string; lineup?: string; blank?: string; new?: string; division?: string; dtype?: string; boat?: string; adddiv?: string };

export default async function AdminLineupsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { event: eventId, lineup: lineupId, blank } = sp;
  const { org } = await requireAdmin();
  const supabase = await createClient();

  const { data: events } = await supabase.from("events").select("id, title, starts_at").eq("org_id", org.id).order("starts_at", { ascending: false }).limit(30);

  // Home: Google Forms-style day picker (blue). Selecting a day opens its lineup workspace.
  // Only needs per-day counts for the days shown — not the full lineup rows (fat jsonb).
  if (!eventId && !blank) {
    const { data: lineups } = (events ?? []).length
      ? await supabase.from("lineups").select("event_id, published").eq("org_id", org.id).in("event_id", (events ?? []).map((e) => e.id))
      : { data: [] };
    const byEvent = new Map<string, { n: number; pub: number }>();
    for (const l of lineups ?? []) {
      if (!l.event_id) continue;
      const c = byEvent.get(l.event_id) ?? { n: 0, pub: 0 };
      c.n += 1; if (l.published) c.pub += 1;
      byEvent.set(l.event_id, c);
    }
    return (
      <div className="-m-4 md:-m-6 min-h-full">
        <div className="border-b px-4 py-5 md:px-8" style={{ background: "var(--g-blue-tint)", borderColor: "var(--g-grey-300)" }}>
          <div className="mx-auto max-w-[1100px]">
            <h1 className="text-2xl font-normal" style={{ color: "var(--g-blue)" }}><Icon name="boat" /> Lineups</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--g-grey-600)" }}>Pick a day to build its boat lineups — the roster is whoever RSVP’d yes/maybe. Or start from the full roster:</p>
            <Link href="/admin/lineups?blank=1" className="btn-secondary mt-3 inline-block">Blank lineup (full roster)</Link>
          </div>
        </div>
        <div className="px-4 py-5 md:px-8"><div className="mx-auto max-w-[1100px]">
          <h2 className="mb-3 text-base">Days</h2>
          <DayCardGrid hrefBase="/admin/lineups?event=" color="var(--g-blue)" soft="var(--g-blue-soft)" empty="No event days yet — create days under Events."
            days={(events ?? []).map((e) => {
              const c = byEvent.get(e.id);
              return { id: e.id, title: e.title, starts_at: e.starts_at,
                meta: c ? `${c.n} lineup${c.n === 1 ? "" : "s"}${c.pub ? ` · ${c.pub} published` : " · draft"}` : "no lineups yet",
                metaColor: c?.pub ? "var(--g-green)" : undefined };
            })} />
        </div></div>
      </div>
    );
  }

  // Day workspace (or blank full-roster mode). Fetch only this day's lineups (blank mode: the untied ones).
  const lineupQuery = supabase.from("lineups").select("*").eq("org_id", org.id).order("created_at", { ascending: true });
  const [{ data: members }, { data: lineups }] = await Promise.all([
    supabase.from("memberships").select("profile:profiles(*)").eq("org_id", org.id),
    eventId ? lineupQuery.eq("event_id", eventId) : lineupQuery.is("event_id", null),
  ]);
  const event = eventId ? (events ?? []).find((e) => e.id === eventId) ?? null : null;
  let dayIds: string[] | null = null;
  if (eventId) {
    const { data: rs } = await supabase.from("rsvps").select("user_id, status").eq("event_id", eventId).in("status", ["yes", "maybe"]);
    dayIds = (rs ?? []).map((r) => r.user_id);
  }
  // Full org roster: seated non-RSVP paddlers still render; the bench filters to the day by default.
  const roster: Roster = {};
  for (const m of members ?? []) {
    const p = m.profile as unknown as Profile;
    if (!p) continue;
    roster[p.id] = { id: p.id, name: p.full_name || p.email, weight: p.weight_lb ?? 0, gender: p.gender, sidePreference: p.side_preference, canSteer: p.can_steer, canDrum: p.can_drum };
  }

  const forEvent = (lineups ?? []) as LineupRow[];
  const practiceRows = forEvent.filter((l) => !l.division);
  const raceRows = forEvent.filter((l) => l.division);
  const current = lineupId ? forEvent.find((l) => l.id === lineupId) ?? null : null;

  // Race-day context for the builder: from the selected row, or from ?division=…&new=1 (new race).
  const division = current?.division ?? (sp.new === "1" ? (sp.division || null) : null);
  const boatLabel = current?.boat_label ?? (division ? sp.boat || "A" : null);
  const boatType = (current?.boat_type ?? (division ? (sp.dtype as BoatType) || "open" : "open")) as BoatType;
  const siblings = division
    ? raceRows.filter((l) => l.division === division && l.boat_label !== boatLabel)
        .map((l) => ({ name: `${l.division} ${l.boat_label ?? ""}`.trim(), lineup: l.data as unknown as Lineup }))
    : [];

  const showChooser = !!eventId && forEvent.length === 0 && !sp.new && !sp.adddiv;
  const addDivision = sp.adddiv === "1";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/lineups" className="btn-text -ml-3" style={{ color: "var(--g-blue)" }}>← Lineups</Link>
        <h1 className="text-2xl font-normal">{event ? event.title : "Blank lineup"}</h1>
        {event && <span className="text-sm" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={event.starts_at} /></span>}
        {!event && <span className="text-sm" style={{ color: "var(--g-grey-600)" }}>full roster — not tied to a day</span>}
      </div>

      {showChooser ? (
        <div>
          <p className="mb-3 text-sm" style={{ color: "var(--g-grey-600)" }}>Start this day’s lineups from:</p>
          <div className="flex flex-wrap gap-4">
            <TemplateCard href={`/admin/lineups?event=${eventId}&adddiv=1`} icon="race" title="Race day"
              blurb="Divisions (Open, Mixed 500m, …) with boats A/B and a lineup per race." />
            <TemplateCard href={`/admin/lineups?event=${eventId}&new=practice`} icon="boat" title="Practice"
              blurb="One boat at a time from the day’s RSVPs." />
            <TemplateCard href={`/admin/lineups?event=${eventId}&new=custom`} icon="pen" title="Custom"
              blurb="Blank boat with the whole team on the bench." />
          </div>
        </div>
      ) : (
        <>
          {(raceRows.length > 0 || addDivision) && (
            <RaceDaySections eventId={eventId!} rows={raceRows} currentId={current?.id ?? null} />
          )}
          {addDivision && (
            <form method="GET" action="/admin/lineups" className="card flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="event" value={eventId!} />
              <input type="hidden" name="new" value="1" />
              <input type="hidden" name="boat" value="A" />
              <label className="grid gap-1">Division name
                <input name="division" required placeholder="e.g. Mixed 500m" className="input w-48" />
              </label>
              <label className="grid gap-1">Type (for warnings)
                <select name="dtype" className="input w-auto" defaultValue="mixed">
                  <option value="open">Open</option><option value="mixed">Mixed</option><option value="womens">Women&apos;s</option>
                </select>
              </label>
              <button className="btn-primary">Add division</button>
              <Link href={`/admin/lineups?event=${eventId}`} className="btn-text">Cancel</Link>
            </form>
          )}
          {practiceRows.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {practiceRows.map((l) => (
                <Link key={l.id} href={`/admin/lineups?${eventId ? `event=${eventId}&` : "blank=1&"}lineup=${l.id}`}
                  className={`rounded-full border px-3 py-1 ${l.id === lineupId ? "border-sky-600 bg-sky-50" : "border-slate-300"}`}>
                  {l.name} <span className="text-slate-400">· {l.boat_type}{l.published ? " · published" : ""}</span>
                </Link>
              ))}
              <Link href={`/admin/lineups${eventId ? `?event=${eventId}&new=practice` : "?blank=1"}`} className={`rounded-full border px-3 py-1 ${!lineupId && !division ? "border-sky-600 bg-sky-50" : "border-dashed border-slate-300"}`}>+ New</Link>
            </div>
          )}
          {!addDivision && (current || sp.new || raceRows.length === 0) && (
            <LineupBuilder
              key={current?.id ?? `new:${division ?? ""}:${boatLabel ?? ""}:${sp.new ?? ""}`}
              roster={roster}
              eventId={eventId ?? null}
              initial={current ? { id: current.id, name: current.name, boatType: current.boat_type as BoatType, published: current.published, data: current.data as unknown as Lineup } : null}
              defaultBoatType={boatType}
              division={division}
              boatLabel={boatLabel}
              siblings={siblings}
              dayIds={dayIds}
              initialWholeTeam={sp.new === "custom" || !eventId}
            />
          )}
        </>
      )}
    </div>
  );
}

function TemplateCard({ href, icon, title, blurb }: { href: string; icon: "race" | "boat" | "pen"; title: string; blurb: string }) {
  return (
    <Link href={href} className="w-52 rounded-lg border bg-white p-3 transition-colors hover:border-[var(--g-blue)]" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="mb-2 flex h-20 items-center justify-center rounded" style={{ background: "var(--g-blue-tint)", color: "var(--g-blue)" }}>
        <Icon name={icon} className="text-2xl" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--g-grey-600)" }}>{blurb}</div>
    </Link>
  );
}
