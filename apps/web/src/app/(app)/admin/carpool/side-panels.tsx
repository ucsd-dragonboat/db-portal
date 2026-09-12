"use client";

import { useState } from "react";
import type { CarpoolGuest, GuestCol, Rider } from "@db/carpool";

const GRID = "#e0e0e0";
const cellBorder = { borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` };
const cell = "flex h-[22px] items-center px-1 text-[13px]";
// Empty-cell filler that draws horizontal gridlines every 22px, so columns read as
// a full spreadsheet grid down to whatever height the sheet stretches to.
const fillerStyle = {
  background: `repeating-linear-gradient(to bottom, #fff 0 21px, ${GRID} 21px 22px)`,
  borderRight: `1px solid ${GRID}`,
};

const Chip = ({ id, name, note, onRemove }: { id: string; name: string; note?: string; onRemove?: () => void }) => (
  <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `rider:${id}:roster`)}
    className={`${cell} group cursor-grab justify-between gap-1 bg-white`} style={cellBorder}>
    <span className="min-w-0 flex-1 truncate">{name}</span>
    {note && <span className="shrink-0 text-[10px]" style={{ color: "var(--g-grey-600)" }}>{note}</span>}
    {onRemove && <button type="button" onClick={onRemove} tabIndex={-1} className="hidden shrink-0 text-slate-300 hover:text-red-600 group-hover:inline" title="Remove this write-in">✕</button>}
  </div>
);

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
export function TotalPanel({ riders, drivers, grouped, selfIds, guests, placedNote, onUnseatDrop, onAddGuest, onRemoveGuest }: {
  riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[];
  grouped: { onCampus: { keyword: string; ids: string[] }[]; offCampus: string[] };
  selfIds: string[];
  guests: CarpoolGuest[];
  /** riderId → " · G B" note showing where they're already placed. */
  placedNote: (id: string) => string;
  onUnseatDrop: (payload: string) => void;
  onAddGuest: (col: GuestCol, name: string) => void;
  onRemoveGuest: (id: string) => void;
}) {
  const name = (id: string) => riders[id]?.name ?? "?";
  const guestsIn = (col: GuestCol) => guests.filter((g) => g.col === col);
  const onCampusCount = grouped.onCampus.reduce((n, g) => n + g.ids.length, 0);
  const counts = [
    drivers.length + guestsIn("drivers").length,
    grouped.offCampus.length + guestsIn("offCampus").length,
    onCampusCount + guestsIn("onCampus").length,
    selfIds.length + guestsIn("diy").length,
  ];
  const col = "flex w-[110px] shrink-0 flex-col";
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
        <div className={col}>
          {drivers.map((d) => <Chip key={d.id} id={d.id} name={name(d.id)} note={`${d.seats - 1}${placedNote(d.id)}`} />)}
          {guestRows("drivers")}
        </div>
        <div className={col}>
          {grouped.offCampus.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
          {guestRows("offCampus")}
        </div>
        <div className={col}>
          {grouped.onCampus.map((g) => (
            <div key={g.keyword}>
              <div className={`${cell} font-medium uppercase`} style={{ background: "#a2c4c9", ...cellBorder }}>{g.keyword}</div>
              {g.ids.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
            </div>
          ))}
          {guestRows("onCampus")}
        </div>
        <div className={col}>
          {selfIds.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
          {guestRows("diy")}
        </div>
      </div>
      <p className="px-1 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>Drag a name into a car; drop one here to unseat. Type in a column to add a temporary write-in. G/B = placed Going/Back.</p>
    </div>
  );
}

/** The template's yellow columns: pick a form question, rows of Name | Response. */
export function FunFactPanel({ questions, answers, questionId, onPickQuestion, riders }: {
  questions: { id: string; label: string }[];
  answers: Record<string, { userId: string; text: string }[]>;
  questionId: string | null;
  onPickQuestion: (id: string | null) => void;
  riders: Record<string, Rider>;
}) {
  if (!questions.length) return null;
  const rows = (questionId ? answers[questionId] ?? [] : []).filter((r) => riders[r.userId]);
  return (
    <div className="w-[300px] shrink-0 text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <select value={questionId ?? ""} onChange={(e) => onPickQuestion(e.target.value || null)}
        className="h-[24px] w-full bg-white px-1 text-[12px] outline-none" style={cellBorder}>
        <option value="">Fun fact: pick a form question…</option>
        {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
      </select>
      {questionId && rows.map((r) => (
        <div key={r.userId} className="flex" style={{ background: "#ffff00" }}>
          <div className={`${cell} w-[110px] shrink-0 truncate`} style={cellBorder} title={riders[r.userId].name}>{riders[r.userId].name}</div>
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
  const c = `${cell} w-[130px] shrink-0`;
  return (
    <div className="w-max text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex bg-white font-bold">
        <div className={c} style={cellBorder}>Name</div>
        <div className={c} style={cellBorder}>Need Ride Going</div>
        <div className={c} style={cellBorder}>Need Ride Back</div>
      </div>
      {sorted.map((r) => (
        <div key={r.id} className="flex bg-white">
          <div className={c} style={cellBorder}>{riders[r.id]?.name ?? "?"}</div>
          <div className={`${c} justify-center font-medium`} style={{ ...cellBorder, color: "var(--g-red)" }}>{r.needGoing ? 1 : ""}</div>
          <div className={`${c} justify-center font-medium`} style={{ ...cellBorder, color: "var(--g-red)" }}>{r.needBack ? 1 : ""}</div>
        </div>
      ))}
      {!sorted.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>No discrepancies 🎉</div>}
    </div>
  );
}
