"use client";

import type { Rider } from "@db/carpool";

const GRID = "#e0e0e0";
const cellBorder = { borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` };
const cell = "flex h-[22px] items-center px-1 text-[13px]";

const Chip = ({ id, name, note }: { id: string; name: string; note?: string }) => (
  <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `rider:${id}:roster`)}
    className={`${cell} cursor-grab justify-between gap-1 bg-white`} style={cellBorder}>
    <span className="min-w-0 flex-1 truncate">{name}</span>
    {note && <span className="shrink-0 text-[10px]" style={{ color: "var(--g-grey-600)" }}>{note}</span>}
  </div>
);

/** Right-of-grid TOTAL block, styled like the template: teal TOTAL header, light-blue
 * counts row, DRIVERS/NEED RIDE/NEED RIDE/DIY headers with the red/blue campus
 * subheaders, teal college labels. Whole block is the unseat drop target. */
export function TotalPanel({ riders, drivers, grouped, selfIds, placedNote, onUnseatDrop }: {
  riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[];
  grouped: { onCampus: { keyword: string; ids: string[] }[]; offCampus: string[] };
  selfIds: string[];
  /** riderId → " · G B" note showing where they're already placed. */
  placedNote: (id: string) => string;
  onUnseatDrop: (payload: string) => void;
}) {
  const name = (id: string) => riders[id]?.name ?? "?";
  const onCampusCount = grouped.onCampus.reduce((n, g) => n + g.ids.length, 0);
  const counts = [drivers.length, grouped.offCampus.length, onCampusCount, selfIds.length];
  const col = "w-[110px] shrink-0";
  return (
    <div onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onUnseatDrop(e.dataTransfer.getData("text/plain")); }}
      className="text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex">
        <div className={`${cell} w-[220px] shrink-0 justify-center font-medium`} style={{ background: "#76a5af", ...cellBorder }}>TOTAL</div>
        <div className={`${cell} w-[110px] shrink-0`} style={{ background: "#76a5af", ...cellBorder }} />
        <div className={`${cell} w-[110px] shrink-0 justify-center font-medium`} style={{ background: "#76a5af", ...cellBorder }}>{Object.keys(riders).length}</div>
      </div>
      <div className="flex">
        {counts.map((n, i) => <div key={i} className={`${cell} ${col} justify-end`} style={{ background: "#d0e0e3", ...cellBorder }}>{n}</div>)}
      </div>
      <div className="flex">
        <div className={`${cell} ${col} font-medium`} style={{ background: "#a2dde0", ...cellBorder }}>DRIVERS</div>
        <div className={`${cell} ${col} font-medium`} style={{ background: "#ffd966", ...cellBorder }}>NEED RIDE</div>
        <div className={`${cell} ${col} font-medium`} style={{ background: "#ffd966", ...cellBorder }}>NEED RIDE</div>
        <div className={`${cell} ${col} font-medium`} style={{ background: "#d6ccfe", ...cellBorder }}>DIY</div>
      </div>
      <div className="flex">
        <div className={`${cell} ${col} bg-white`} style={cellBorder} />
        <div className={`${cell} ${col} font-medium text-white`} style={{ background: "#cc0000", ...cellBorder }}>OFF CAMPUS</div>
        <div className={`${cell} ${col} font-medium text-white`} style={{ background: "#3c78d8", ...cellBorder }}>ON CAMPUS</div>
        <div className={`${cell} ${col} bg-white`} style={cellBorder} />
      </div>
      <div className="flex items-start">
        <div className={col}>{drivers.map((d) => <Chip key={d.id} id={d.id} name={name(d.id)} note={`${d.seats - 1}${placedNote(d.id)}`} />)}</div>
        <div className={col}>{grouped.offCampus.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}</div>
        <div className={col}>
          {grouped.onCampus.map((g) => (
            <div key={g.keyword}>
              <div className={`${cell} font-medium uppercase`} style={{ background: "#a2c4c9", ...cellBorder }}>{g.keyword}</div>
              {g.ids.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
            </div>
          ))}
        </div>
        <div className={col}>{selfIds.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}</div>
      </div>
      <p className="px-1 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>Drag a name into a car; drop one here to unseat. G/B = placed Going/Back.</p>
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
