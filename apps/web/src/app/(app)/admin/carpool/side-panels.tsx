"use client";

import { useState } from "react";
import type { CarpoolGuest, FormChange, GuestCol, Rider } from "@db/carpool";

const GRID = "#e0e0e0";
const cellBorder = { borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` };
const cell = "flex h-[22px] items-center px-1 text-[13px]";
// Empty-cell filler that draws horizontal gridlines every 22px, so columns read as
// a full spreadsheet grid down to whatever height the sheet stretches to.
const fillerStyle = {
  background: `repeating-linear-gradient(to bottom, #fff 0 21px, ${GRID} 21px 22px)`,
  borderRight: `1px solid ${GRID}`,
};

/** A person in a TOTAL column, compared with their form response like a GitHub diff:
 * "same" as the form, "removed" (red −, the form put them here) or "added" (green +,
 * this layout put them here). dirs = "G"/"B" when it's only one direction. */
export type DiffChip = { id: string; state: "same" | "removed" | "added"; dirs: string; partial: boolean; changes: FormChange[]; seats: FormChange[] };

const DIFF = {
  removed: { bg: "#ffebe9", fg: "#cf222e", sign: "−" },
  added: { bg: "#dafbe1", fg: "#1a7f37", sign: "+" },
};

const Chip = ({ id, name, note, onRemove, diff, title, onRevert }: {
  id: string; name: string; note?: React.ReactNode; onRemove?: () => void;
  diff?: { state: "removed" | "added"; dirs: string; strike: boolean }; title?: string; onRevert?: () => void;
}) => {
  const d = diff ? DIFF[diff.state] : null;
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `rider:${id}:roster`)}
      className={`${cell} group cursor-grab justify-between gap-1`} style={{ ...cellBorder, background: d?.bg ?? "#fff" }} title={title}>
      {d && <span className="shrink-0 font-medium" style={{ color: d.fg }}>{d.sign}</span>}
      <span className={`min-w-0 flex-1 truncate ${diff?.strike ? "line-through" : ""}`} style={d ? { color: d.fg } : undefined}>{name}</span>
      {diff?.dirs && <span className="shrink-0 rounded-sm px-0.5 text-[10px] font-medium" style={{ color: d!.fg, border: `1px solid ${d!.fg}` }}>{diff.dirs}</span>}
      {note && <span className="shrink-0 text-[10px]" style={{ color: "var(--g-grey-600)" }}>{note}</span>}
      {onRevert && <button type="button" onClick={onRevert} tabIndex={-1} className="shrink-0 text-[11px]" style={{ color: DIFF.added.fg }} title="Revert to the form response">↺</button>}
      {onRemove && <button type="button" onClick={onRemove} tabIndex={-1} className="hidden shrink-0 text-slate-300 hover:text-red-600 group-hover:inline" title="Remove this write-in">✕</button>}
    </div>
  );
};

const ROLE_NAME = { driver: "driving", rider: "needs a ride", diy: "DIY" } as const;
const dirName = (c: FormChange) => (c.dir === "going" ? "Going" : "Back");

/** One free-text cell per column: type a name, Enter/blur writes them in. */
function GuestInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  const commit = () => { if (v.trim()) onAdd(v.trim()); setV(""); };
  return (
    <div className={`${cell} bg-white`} style={cellBorder}>
      <input value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setV(""); }}
        onBlur={commit} placeholder="+ write in…"
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-slate-300" />
    </div>
  );
}

/** Right-of-grid TOTAL block, styled like the template. Columns accept hand-typed
 * write-ins (guests) and stretch to the sheet's full height with gridlines. */
export function TotalPanel({ riders, drivers, driverSeats, grouped, diy, guests, placedNote, onUnseatDrop, onRoleDrop, onAddGuest, onRemoveGuest, onRevert }: {
  riders: Record<string, Rider>;
  drivers: DiffChip[];
  /** Seats (incl. driver) each form driver put on the form. */
  driverSeats: Map<string, number>;
  grouped: { onCampus: { keyword: string; chips: DiffChip[] }[]; offCampus: DiffChip[] };
  diy: DiffChip[];
  guests: CarpoolGuest[];
  /** riderId → " · G B" note showing where they're already placed. */
  placedNote: (id: string) => string;
  onUnseatDrop: (payload: string) => void;
  /** A person dropped on one of the columns (switches how they ride). */
  onRoleDrop: (col: GuestCol, payload: string) => void;
  onAddGuest: (col: GuestCol, name: string) => void;
  onRemoveGuest: (id: string) => void;
  onRevert: (changes: FormChange[]) => void;
}) {
  const name = (id: string) => riders[id]?.name ?? "?";
  const guestsIn = (col: GuestCol) => guests.filter((g) => g.col === col);
  // Counts are this layout's: someone moved out of a column in both directions isn't counted there.
  const live = (cs: DiffChip[]) => cs.filter((c) => !(c.state === "removed" && !c.partial)).length;
  const onCampusCount = grouped.onCampus.reduce((n, g) => n + live(g.chips), 0);
  const counts = [
    live(drivers) + guestsIn("drivers").length,
    live(grouped.offCampus) + guestsIn("offCampus").length,
    onCampusCount + guestsIn("onCampus").length,
    live(diy) + guestsIn("diy").length,
  ];
  const chip = (c: DiffChip, seatsNote?: boolean) => {
    const seatsBase = seatsNote ? driverSeats.get(c.id) : undefined;
    const seatTo = c.seats[0]?.kind === "seats" ? c.seats[0].to : undefined;
    const seats = seatsBase == null ? null
      : seatTo != null ? <span style={{ color: "#9a6700" }} title={`Form: ${seatsBase - 1} seats · this layout: ${seatTo - 1} (${c.seats.map(dirName).join(", ")})`}>{seatsBase - 1}→{seatTo - 1}</span>
      : `${seatsBase - 1}`;
    const title = c.state === "added"
      ? `Changed in this layout: ${c.changes.map((x) => x.kind === "role" ? `${dirName(x)} — form says ${ROLE_NAME[x.from]}, now ${ROLE_NAME[x.to]}` : "").join("; ")}`
      : c.state === "removed" ? `The form puts them here; this layout moved them${c.partial ? ` (${c.dirs === "G" ? "Going" : "Back"} only)` : ""}` : undefined;
    const revertable = [...(c.state === "added" ? c.changes : []), ...c.seats];
    return (
      <Chip key={`${c.id}:${c.state}`} id={c.id} name={name(c.id)} title={title}
        note={<>{seats}{placedNote(c.id)}</>}
        diff={c.state === "same" ? undefined : { state: c.state, dirs: c.dirs, strike: c.state === "removed" && !c.partial }}
        onRevert={revertable.length ? () => onRevert(revertable) : undefined} />
    );
  };
  const [over, setOver] = useState<GuestCol | null>(null);
  const col = "flex w-[110px] shrink-0 flex-col";
  // Each column is its own drop target; the rest of the panel still unseats.
  const dropCol = (c: GuestCol) => ({
    className: `${col} ${over === c ? "ring-2 ring-inset ring-sky-400" : ""}`,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(c); },
    onDragLeave: () => setOver((o) => (o === c ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(null); onRoleDrop(c, e.dataTransfer.getData("text/plain")); },
  });
  const guestRows = (c: GuestCol) => (
    <>
      {guestsIn(c).map((g) => <Chip key={g.id} id={g.id} name={g.name} note={placedNote(g.id)} onRemove={() => onRemoveGuest(g.id)} />)}
      <GuestInput onAdd={(n) => onAddGuest(c, n)} />
      <div className="min-h-[22px] flex-1" style={fillerStyle} />
    </>
  );
  return (
    <div onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onUnseatDrop(e.dataTransfer.getData("text/plain")); }}
      className="flex flex-col self-stretch text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex">
        <div className={`${cell} w-[220px] shrink-0 justify-center font-medium`} style={{ background: "#76a5af", ...cellBorder }}>TOTAL</div>
        <div className={`${cell} w-[110px] shrink-0`} style={{ background: "#76a5af", ...cellBorder }} />
        <div className={`${cell} w-[110px] shrink-0 justify-center font-medium`} style={{ background: "#76a5af", ...cellBorder }}>{Object.keys(riders).length}</div>
      </div>
      <div className="flex">
        {counts.map((n, i) => <div key={i} className={`${cell} w-[110px] shrink-0 justify-end`} style={{ background: "#d0e0e3", ...cellBorder }}>{n}</div>)}
      </div>
      <div className="flex">
        <div className={`${cell} w-[110px] shrink-0 font-medium`} style={{ background: "#a2dde0", ...cellBorder }}>DRIVERS</div>
        <div className={`${cell} w-[110px] shrink-0 font-medium`} style={{ background: "#ffd966", ...cellBorder }}>NEED RIDE</div>
        <div className={`${cell} w-[110px] shrink-0 font-medium`} style={{ background: "#ffd966", ...cellBorder }}>NEED RIDE</div>
        <div className={`${cell} w-[110px] shrink-0 font-medium`} style={{ background: "#d6ccfe", ...cellBorder }}>DIY</div>
      </div>
      <div className="flex">
        <div className={`${cell} w-[110px] shrink-0 bg-white`} style={cellBorder} />
        <div className={`${cell} w-[110px] shrink-0 font-medium text-white`} style={{ background: "#cc0000", ...cellBorder }}>OFF CAMPUS</div>
        <div className={`${cell} w-[110px] shrink-0 font-medium text-white`} style={{ background: "#3c78d8", ...cellBorder }}>ON CAMPUS</div>
        <div className={`${cell} w-[110px] shrink-0 bg-white`} style={cellBorder} />
      </div>
      <div className="flex flex-1 items-stretch">
        <div {...dropCol("drivers")}>
          {drivers.map((c) => chip(c, true))}
          {guestRows("drivers")}
        </div>
        <div {...dropCol("offCampus")}>
          {grouped.offCampus.map((c) => chip(c))}
          {guestRows("offCampus")}
        </div>
        <div {...dropCol("onCampus")}>
          {grouped.onCampus.map((g) => (
            <div key={g.keyword}>
              <div className={`${cell} font-medium uppercase`} style={{ background: "#a2c4c9", ...cellBorder }}>{g.keyword}</div>
              {g.chips.map((c) => chip(c))}
            </div>
          ))}
          {guestRows("onCampus")}
        </div>
        <div {...dropCol("diy")}>
          {diy.map((c) => chip(c))}
          {guestRows("diy")}
        </div>
      </div>
      <p className="px-1 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>Drag a name into a car, or between these columns to switch driver / needs a ride / DIY (both directions); drop a passenger on their own column to unseat. Drag a car&apos;s driver name to move the car; drop a person on a driver cell to make them the driver. Type in a column to add a temporary write-in. G/B = placed Going/Back.
        <br /><span style={{ color: DIFF.removed.fg }}>− red</span> / <span style={{ color: DIFF.added.fg }}>+ green</span> = changed from the form in this layout only (boxed G/B = that direction); ↺ reverts. Form responses are never edited.</p>
    </div>
  );
}

/** Name | Note rows: where people are picked up or driving from, when it isn't their
 * home address — kept here so the car cells show just names. */
export function NotesPanel({ notes, riders }: { notes: Record<string, string>; riders: Record<string, Rider> }) {
  const ids = Object.keys(notes).filter((id) => notes[id] && riders[id]).sort((a, b) => riders[a].name.localeCompare(riders[b].name));
  return (
    <div className="w-max text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex bg-white font-bold">
        <div className={`${cell} w-[150px] shrink-0`} style={cellBorder}>Name</div>
        <div className={`${cell} w-[300px] shrink-0`} style={cellBorder}>Pickup notes</div>
      </div>
      {ids.map((id) => (
        <div key={id} className="flex bg-white">
          <div className={`${cell} w-[150px] shrink-0 min-w-0`} style={cellBorder} title={riders[id].name}><span className="truncate">{riders[id].name}</span></div>
          <div className={`${cell} w-[300px] shrink-0 min-w-0`} style={cellBorder} title={notes[id]}><span className="truncate">{notes[id]}</span></div>
        </div>
      ))}
      {!ids.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>Everyone&apos;s using their home address</div>}
    </div>
  );
}

/** The template's yellow columns: pick a form question, rows of Name | Response. */
/** Everyone who answered the chosen question on the day's form — not just this day's riders. */
export function FunFactPanel({ questions, answers, questionId, onPickQuestion }: {
  questions: { id: string; label: string }[];
  answers: Record<string, { userId: string; name: string; text: string }[]>;
  questionId: string | null;
  onPickQuestion: (id: string | null) => void;
}) {
  if (!questions.length) return null;
  const rows = questionId ? answers[questionId] ?? [] : [];
  return (
    <div className="w-[300px] shrink-0 text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <select value={questionId ?? ""} onChange={(e) => onPickQuestion(e.target.value || null)}
        className="h-[24px] w-full bg-white px-1 text-[12px] outline-none" style={cellBorder}>
        <option value="">Fun fact: pick a form question…</option>
        {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
      </select>
      {questionId && rows.map((r) => (
        <div key={r.userId} className="flex" style={{ background: "#ffff00" }}>
          <div className={`${cell} w-[110px] shrink-0 truncate`} style={cellBorder} title={r.name}>{r.name}</div>
          <div className="min-w-0 flex-1 whitespace-pre-wrap px-1 py-0.5 text-[13px]" style={cellBorder}>{r.text}</div>
        </div>
      ))}
      {questionId && !rows.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>No responses yet.</div>}
    </div>
  );
}

/** Name | Need Ride Going | Need Ride Back — people covered both ways are excluded. */
export function DiscrepancyTracker({ rows, riders }: {
  rows: { id: string; needGoing: boolean; needBack: boolean }[];
  riders: Record<string, Rider>;
}) {
  const sorted = [...rows].sort((a, b) => (riders[a.id]?.name ?? "").localeCompare(riders[b.id]?.name ?? ""));
  const going = rows.filter((r) => r.needGoing).length, back = rows.filter((r) => r.needBack).length;
  const c = `${cell} w-[130px] shrink-0`;
  // Names can carry a long typed pickup address ("Alex @ 123 Some St…"); the cells are a
  // fixed row height, so keep each name on one line and show the rest on hover.
  const nameCell = `${cell} w-[240px] shrink-0 min-w-0`;
  return (
    <div className="w-max text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex bg-white font-bold">
        <div className={nameCell} style={cellBorder}>Name</div>
        <div className={c} style={cellBorder}>Need Ride Going</div>
        <div className={c} style={cellBorder}>Need Ride Back</div>
      </div>
      {sorted.map((r) => (
        <div key={r.id} className="flex bg-white">
          <div className={nameCell} style={cellBorder} title={riders[r.id]?.name}><span className="truncate">{riders[r.id]?.name ?? "?"}</span></div>
          <div className={`${c} justify-center font-medium`} style={{ ...cellBorder, color: "var(--g-red)" }}>{r.needGoing ? 1 : ""}</div>
          <div className={`${c} justify-center font-medium`} style={{ ...cellBorder, color: "var(--g-red)" }}>{r.needBack ? 1 : ""}</div>
        </div>
      ))}
      {!sorted.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>No discrepancies 🎉</div>}
      <div className="flex font-bold" style={{ background: "#d0e0e3" }}>
        <div className={nameCell} style={cellBorder}>Total</div>
        <div className={`${c} justify-center`} style={{ ...cellBorder, color: going ? "var(--g-red)" : undefined }}>{going}</div>
        <div className={`${c} justify-center`} style={{ ...cellBorder, color: back ? "var(--g-red)" : undefined }}>{back}</div>
      </div>
    </div>
  );
}
