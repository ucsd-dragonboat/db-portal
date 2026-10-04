"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  autoFill, emptyLineup, getSeat, lineupPaddlerIds, lineupWarnings, placePaddler, removePaddler,
  seatDifferenceKeys, seatedElsewhere, swapSeats, toMastersheet,
  type BoatType, type Lineup, type Roster, type Seat,
} from "@db/lineup";
import BoatGrid, { type Sel } from "./boat-grid";
import FileDialog, { type FilingGroup } from "./file-dialog";
import { deleteLineupSet, fetchAttendees, saveLineupSet, type BoatInput } from "./actions";

/** One boat on one day, as held in the builder before it becomes a lineups row. */
type Boat = { key: string; rowId: string | null; name: string; division: string | null; boatLabel: string | null; lineup: Lineup };
/** A day tab. eventId null = not filed yet (the single "Unfiled" tab). */
type Day = { key: string; eventId: string | null; label: string; boats: Boat[] };

export type BuilderDay = { eventId: string | null; label: string; boats: { rowId: string | null; name: string; division: string | null; boatLabel: string | null; data: Lineup }[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const newBoat = (name: string, boatType: BoatType = "open"): Boat =>
  ({ key: uid(), rowId: null, name, division: null, boatLabel: null, lineup: emptyLineup(boatType) });

export default function LineupBuilder({ setId, roster, groups, initialDays, initialName, initialPublished, initialGroupId, initialAttendees }: {
  setId: string;
  roster: Roster;
  /** Events the lineup can be filed to, with each day's attending count. */
  groups: FilingGroup[];
  initialDays: BuilderDay[];
  initialName: string;
  initialPublished: boolean;
  initialGroupId: string | null;
  /** Attending (yes-only) user ids per day, for the days already filed. */
  initialAttendees: Record<string, string[]>;
}) {
  const router = useRouter();
  const soft = true; // only "one seat per person per boat" blocks; gender rules warn

  const [days, setDays] = useState<Day[]>(() =>
    initialDays.length
      ? initialDays.map((d) => ({
          key: uid(), eventId: d.eventId, label: d.label,
          boats: d.boats.map((b) => ({ key: uid(), rowId: b.rowId, name: b.name, division: b.division, boatLabel: b.boatLabel, lineup: b.data })),
        }))
      : [{ key: uid(), eventId: null, label: "Unfiled", boats: [newBoat("Boat 1")] }],
  );
  const [groupId, setGroupId] = useState(initialGroupId);
  const [name, setName] = useState(initialName);
  const [published, setPublished] = useState(initialPublished);
  const [attendees, setAttendees] = useState<Record<string, string[]>>(initialAttendees);
  const [dayIdx, setDayIdx] = useState(0);
  const [boatIdx, setBoatIdx] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [wholeTeam, setWholeTeam] = useState(false);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [pending, start] = useTransition();

  const day = days[Math.min(dayIdx, days.length - 1)];
  const boat = day.boats[Math.min(boatIdx, day.boats.length - 1)] ?? null;
  const lineup = boat?.lineup ?? emptyLineup("open");
  const filed = days.some((d) => d.eventId);

  // Who's attending this tab's day; null before the lineup is filed (whole team).
  const daySet = useMemo(() => {
    const ids = day.eventId ? attendees[day.eventId] : null;
    return ids ? new Set(ids) : null;
  }, [day.eventId, attendees]);

  const seated = useMemo(() => new Set(lineupPaddlerIds(lineup)), [lineup]);
  const elsewhere = useMemo(
    () => seatedElsewhere(day.boats.filter((b) => b.key !== boat?.key).map((b) => ({ name: b.name, lineup: b.lineup }))),
    [day.boats, boat?.key],
  );
  const bench = useMemo(() =>
    Object.values(roster)
      .filter((p) => !seated.has(p.id) && (!daySet || wholeTeam || daySet.has(p.id)) && p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [roster, seated, search, daySet, wholeTeam]);

  // Seated on a day they aren't signed up for — warn, never unseat behind their back.
  const notAttending = useMemo(
    () => (daySet ? lineupPaddlerIds(lineup).filter((pid) => !daySet.has(pid)) : []),
    [daySet, lineup]);
  const warnings = useMemo(() => [
    ...lineupWarnings(lineup, roster),
    ...lineupPaddlerIds(lineup).filter((pid) => elsewhere.has(pid)).map((pid) => `${roster[pid]?.name ?? pid} is also in ${elsewhere.get(pid)!.join(", ")}`),
  ], [lineup, roster, elsewhere]);

  const diffKeys = useMemo(() => {
    if (!compareTo || !boat) return undefined;
    const other = days.find((d) => d.key === compareTo)?.boats.find((b) => b.name === boat.name);
    return other ? seatDifferenceKeys(boat.lineup, other.lineup) : undefined;
  }, [compareTo, days, boat]);

  // ---- mutation helpers -----------------------------------------------------
  const setBoatLineup = (next: Lineup) =>
    setDays((ds) => ds.map((d, i) => (i !== dayIdx ? d : { ...d, boats: d.boats.map((b) => (b.key === boat?.key ? { ...b, lineup: next } : b)) })));
  const apply = (r: { lineup: Lineup; error?: string }) => { setError(r.error ?? null); if (!r.error) setBoatLineup(r.lineup); };

  const clickSeat = (seat: Seat) => {
    setMsg(null);
    if (!sel) { if (getSeat(lineup, seat)) setSel({ kind: "seat", seat }); return; }
    if (sel.kind === "roster") { apply(placePaddler(lineup, seat, sel.id, roster, { soft })); setSel(null); return; }
    apply(swapSeats(lineup, sel.seat, seat, roster, { soft })); setSel(null);
  };
  const clickBench = (pid: string) => {
    setMsg(null);
    if (sel?.kind === "seat") { setBoatLineup(removePaddler(lineup, sel.seat)); setSel(null); return; }
    setSel(sel?.kind === "roster" && sel.id === pid ? null : { kind: "roster", id: pid });
  };
  const removeSelected = () => { if (sel?.kind === "seat") { setBoatLineup(removePaddler(lineup, sel.seat)); setSel(null); } };
  const fill = () => {
    const r = autoFill(lineup, roster, { sidePreferenceTolerance: 20 /* lb */, eligible: wholeTeam ? undefined : daySet ?? undefined });
    setBoatLineup(r.lineup);
    setMsg(r.unplaced.length ? `${r.unplaced.length} paddler(s) could not be placed` : null);
  };
  const unseatNotAttending = () => {
    let next = lineup;
    for (const pid of notAttending) {
      const seat = lineupPaddlerIds(next).includes(pid) ? findSeat(next, pid) : null;
      if (seat) next = removePaddler(next, seat);
    }
    setBoatLineup(next); setSel(null);
  };

  const addBoat = () => setDays((ds) => ds.map((d, i) => (i !== dayIdx ? d : { ...d, boats: [...d.boats, newBoat(`Boat ${d.boats.length + 1}`, lineup.boatType)] })));
  const removeBoat = () => {
    if (day.boats.length <= 1 || !boat) return;
    setDays((ds) => ds.map((d, i) => (i !== dayIdx ? d : { ...d, boats: d.boats.filter((b) => b.key !== boat.key) })));
    setBoatIdx(0);
  };
  const renameBoat = (v: string) => setDays((ds) => ds.map((d, i) => (i !== dayIdx ? d : { ...d, boats: d.boats.map((b) => (b.key === boat?.key ? { ...b, name: v } : b)) })));
  const changeBoatType = (bt: BoatType) => setBoatLineup({ ...emptyLineup(bt), drummer: lineup.drummer, steer: lineup.steer });

  /** Copy this day's boats and seating onto another day — the usual "Sunday starts from Saturday". */
  const duplicateInto = (targetKey: string) => {
    setDays((ds) => ds.map((d) => (d.key !== targetKey ? d : {
      ...d,
      boats: day.boats.map((b) => {
        const existing = d.boats.find((x) => x.name === b.name);
        return { key: uid(), rowId: existing?.rowId ?? null, name: b.name, division: b.division, boatLabel: b.boatLabel, lineup: b.lineup };
      }),
    })));
    setMsg(`Copied ${day.label}'s seating across.`);
  };

  /** Apply a filing choice: re-tab the canvas to the chosen days, carrying boats over. */
  const applyFiling = (next: { groupId: string | null; dayIds: string[]; name: string }) => {
    setFiling(false);
    const group = groups.find((g) => g.id === next.groupId);
    if (!group) return;
    const template = day.boats;
    setDays((prev) => next.dayIds.map((eid) => {
      const existing = prev.find((d) => d.eventId === eid);
      if (existing) return existing;
      return {
        key: uid(), eventId: eid,
        label: group.days.find((d) => d.id === eid)?.label ?? "Day",
        boats: template.map((b) => ({ key: uid(), rowId: null, name: b.name, division: b.division, boatLabel: b.boatLabel, lineup: b.lineup })),
      };
    }));
    setGroupId(next.groupId);
    setName(next.name);
    setDayIdx(0);
    start(async () => setAttendees(await fetchAttendees(next.dayIds)));
  };

  // ---- persistence ----------------------------------------------------------
  const save = (pub: boolean) => start(async () => {
    const boats: BoatInput[] = days.flatMap((d) =>
      d.boats.map((b) => ({ id: b.rowId, eventId: d.eventId, name: name || b.name, boatType: b.lineup.boatType, division: b.division, boatLabel: b.boatLabel, data: b.lineup })));
    const r = await saveLineupSet({ setId, boats, published: pub });
    if ("error" in r) { setError(r.error); return; }
    // Hand the new row ids back so the next save updates rather than duplicating.
    let i = 0;
    setDays((ds) => ds.map((d) => ({ ...d, boats: d.boats.map((b) => ({ ...b, rowId: r.ids[i++] ?? b.rowId })) })));
    setPublished(pub); setError(null); setMsg(pub ? "Published" : "Saved"); router.refresh();
  });
  const publish = () => { if (!filed) { setFiling(true); return; } save(true); };
  const del = () => { if (confirm("Delete this lineup everywhere it's filed?")) start(async () => { await deleteLineupSet(setId); router.push("/admin/lineups"); }); };
  const copy = () => navigator.clipboard
    .writeText(toMastersheet(day.boats.map((b) => ({ name: b.name, lineup: b.lineup })), roster))
    .then(() => setMsg("Copied mastersheet (paste into a spreadsheet)"));

  const nameOf = (pid: string | null) => (pid ? roster[pid]?.name ?? "(left team)" : null);
  const group = groups.find((g) => g.id === groupId) ?? null;

  return (
    <div className="space-y-3">
      {/* filing + name */}
      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lineup name" className="input w-64" />
        <button type="button" onClick={() => setFiling(true)} className="btn-secondary">
          {group ? `${group.name} · ${days.filter((d) => d.eventId).length} day${days.filter((d) => d.eventId).length === 1 ? "" : "s"}` : "Link to an event…"}
        </button>
        {!filed && <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Not linked yet — the whole team is available until you pick days.</span>}
        <span className="flex-1" />
        <button type="button" onClick={copy} className="btn-secondary">Copy sheet</button>
        <button type="button" onClick={() => save(false)} disabled={pending} className="btn-secondary">Save draft</button>
        <button type="button" onClick={publish} disabled={pending} className="btn-primary">{published ? "Save & republish" : "Publish"}</button>
        <button type="button" onClick={del} className="text-red-600 text-xs underline">Delete</button>
      </div>

      {/* day tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {days.map((d, i) => (
          <button key={d.key} type="button" onClick={() => { setDayIdx(i); setBoatIdx(0); setSel(null); }}
            className={`chip ${i === dayIdx ? "!bg-[var(--g-blue-tint)] font-medium" : ""}`}>{d.label}</button>
        ))}
        {days.length > 1 && (
          <>
            <select value="" onChange={(e) => e.target.value && duplicateInto(e.target.value)} className="input w-auto py-0.5 text-xs" title="Copy this day's seating to another day">
              <option value="">Copy {day.label} to…</option>
              {days.filter((d) => d.key !== day.key).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select value={compareTo ?? ""} onChange={(e) => setCompareTo(e.target.value || null)} className="input w-auto py-0.5 text-xs" title="Highlight seats that differ">
              <option value="">Compare with…</option>
              {days.filter((d) => d.key !== day.key).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </>
        )}
      </div>

      {(error || msg) && <p className={`text-sm ${error ? "text-red-600" : "text-green-700"}`}>{error ?? msg}</p>}

      {notAttending.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <p>⚠ {notAttending.length} seated paddler{notAttending.length === 1 ? " isn't" : "s aren't"} attending {day.label}: {notAttending.map((p) => roster[p]?.name ?? p).join(", ")}</p>
          <button type="button" onClick={unseatNotAttending} className="mt-1 btn-text py-0.5 text-xs">Unseat them</button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          {/* boat tabs + per-boat toolbar */}
          <div className="card flex flex-wrap items-center gap-2 text-sm">
            {day.boats.map((b, i) => (
              <button key={b.key} type="button" onClick={() => { setBoatIdx(i); setSel(null); }}
                className={`chip ${i === boatIdx ? "!bg-[var(--g-blue-tint)] font-medium" : ""}`}>{b.name}</button>
            ))}
            <button type="button" onClick={addBoat} className="btn-text py-0.5 text-xs">+ boat</button>
            <span className="flex-1" />
            {boat && <input value={boat.name} onChange={(e) => renameBoat(e.target.value)} className="input w-32" title="Boat name" />}
            <select value={lineup.boatType} onChange={(e) => changeBoatType(e.target.value as BoatType)} className="input w-auto">
              <option value="open">Open</option><option value="mixed">Mixed</option><option value="womens">Women&apos;s</option>
            </select>
            <button type="button" onClick={fill} className="btn-secondary">Auto-fill</button>
            <button type="button" onClick={() => setBoatLineup(emptyLineup(lineup.boatType))} className="btn-secondary">Clear</button>
            <button type="button" onClick={removeSelected} disabled={sel?.kind !== "seat"} className="btn-secondary">Unseat</button>
            {day.boats.length > 1 && <button type="button" onClick={removeBoat} className="text-red-600 text-xs underline">Remove boat</button>}
          </div>

          <BoatGrid lineup={lineup} roster={roster} sel={sel} onClickSeat={clickSeat} diffKeys={diffKeys} />
        </div>

        <aside className="card space-y-2 self-start">
          <div className="flex items-baseline justify-between">
            <h3 className="sheet-title">Available ({bench.length})</h3>
            {daySet ? (
              <label className="text-[11px] text-slate-500 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={wholeTeam} onChange={(e) => setWholeTeam(e.target.checked)} />whole team
              </label>
            ) : <span className="text-[11px] text-slate-500">whole team</span>}
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="input py-1" />
          <p className="text-[11px] text-slate-500">
            {daySet ? "Showing who said yes for this day." : "Link an event to filter to who's attending."}
          </p>
          <ul className="max-h-[60vh] overflow-y-auto">
            {bench.map((p, i) => (
              <li key={p.id} className={`flex items-center ${i > 0 ? "-mt-px" : ""}`}>
                <button type="button" onClick={() => clickBench(p.id)}
                  title={`${p.weight || "?"} lb${p.gender ? ` · ${p.gender}` : ""}${p.canSteer ? " · steers" : ""}${p.canDrum ? " · drums" : ""}`}
                  className={`sheet-cell !w-full flex-1 ${sel?.kind === "roster" && sel.id === p.id ? "sheet-cell-sel" : ""}`}>
                  <span className="sheet-badge">{p.gender ? p.gender[0].toUpperCase() : ""}{p.canSteer ? " S" : ""}{p.canDrum ? " D" : ""}</span>
                  <span className="sheet-name !max-w-[85%]">{p.name}{elsewhere.has(p.id) && <span className="text-amber-600"> ⚠</span>}</span>
                </button>
                <span className="sheet-label">{p.weight ? p.weight.toFixed(0) : ""}</span>
              </li>
            ))}
            {!bench.length && <li className="text-xs text-slate-400 py-2">Nobody left to seat.</li>}
          </ul>
          {sel?.kind === "seat" && <button type="button" onClick={removeSelected} className="btn-secondary w-full">Unseat {nameOf(getSeat(lineup, sel.seat))}</button>}
        </aside>
      </div>

      {filing && (
        <FileDialog groups={groups} groupId={groupId} name={name}
          dayIds={days.map((d) => d.eventId).filter((x): x is string => !!x)}
          onCancel={() => setFiling(false)} onConfirm={applyFiling} />
      )}
    </div>
  );
}

function findSeat(lineup: Lineup, pid: string): Seat | null {
  if (lineup.drummer === pid) return { kind: "drummer" };
  if (lineup.steer === pid) return { kind: "steer" };
  for (let row = 0; row < lineup.seats.length; row++) {
    if (lineup.seats[row][0] === pid) return { kind: "seat", row, side: "left" };
    if (lineup.seats[row][1] === pid) return { kind: "seat", row, side: "right" };
  }
  return null;
}
