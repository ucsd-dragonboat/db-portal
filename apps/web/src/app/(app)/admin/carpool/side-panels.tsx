"use client";

import type { Rider } from "@db/carpool";

const Chip = ({ id, name, note }: { id: string; name: string; note?: string }) => (
  <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `rider:${id}:roster`)}
    className="flex cursor-grab items-center justify-between gap-1 border-b bg-white px-1 py-0.5 text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
    <span className="min-w-0 flex-1 truncate">{name}</span>
    {note && <span className="shrink-0 text-[10px]" style={{ color: "var(--g-grey-600)" }}>{note}</span>}
  </div>
);

/** Right-rail roster, matching the template's four TOTAL columns. Whole panel is a
 * drop target: dropping a placed rider here unseats them from their origin direction. */
export function TotalPanel({ riders, drivers, grouped, selfIds, placedNote, onUnseatDrop }: {
  riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[];
  grouped: { onCampus: { keyword: string; ids: string[] }[]; offCampus: string[] };
  selfIds: string[];
  /** riderId → "G· B" style note showing where they're already placed. */
  placedNote: (id: string) => string;
  onUnseatDrop: (payload: string) => void;
}) {
  const name = (id: string) => riders[id]?.name ?? "?";
  const total = Object.keys(riders).length;
  const col = "min-w-0 flex-1";
  const head = (bg: string, fg: string, label: string, n: number) => (
    <div className="px-1 py-0.5 text-xs font-semibold text-white" style={{ background: bg, color: fg }}>{label} · {n}</div>
  );
  return (
    <div onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onUnseatDrop(e.dataTransfer.getData("text/plain")); }}
      className="rounded border" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="px-2 py-1 text-center text-sm font-semibold" style={{ background: "#76a5af" }}>TOTAL · {total}</div>
      <div className="flex gap-px" style={{ background: "var(--g-grey-300)" }}>
        <div className={col}>
          {head("#a2dde0", "#000", "DRIVERS", drivers.length)}
          {drivers.map((d) => <Chip key={d.id} id={d.id} name={name(d.id)} note={`${d.seats - 1} seats${placedNote(d.id)}`} />)}
        </div>
        <div className={col}>
          {head("#cc0000", "#fff", "NEED RIDE OFF CAMPUS", grouped.offCampus.length)}
          {grouped.offCampus.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
        </div>
        <div className={col}>
          {head("#3c78d8", "#fff", "NEED RIDE ON CAMPUS", grouped.onCampus.reduce((n, g) => n + g.ids.length, 0))}
          {grouped.onCampus.map((g) => (
            <div key={g.keyword}>
              <div className="px-1 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "#a2c4c9" }}>{g.keyword}</div>
              {g.ids.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
            </div>
          ))}
        </div>
        <div className={col}>
          {head("#d6ccfe", "#000", "DIY", selfIds.length)}
          {selfIds.map((id) => <Chip key={id} id={id} name={name(id)} note={placedNote(id)} />)}
        </div>
      </div>
      <p className="px-2 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>Drag a name into a car (or drop one here to unseat). G/B = already placed Going/Back.</p>
    </div>
  );
}

/** Yellow fun-fact panel: pick a form question, show Name | Response. */
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
    <div className="rounded border" style={{ borderColor: "var(--g-grey-300)" }}>
      <select value={questionId ?? ""} onChange={(e) => onPickQuestion(e.target.value || null)} className="input w-full rounded-b-none border-0 border-b py-1 text-xs">
        <option value="">Fun fact column: pick a form question…</option>
        {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
      </select>
      {questionId && (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} style={{ background: "#ffff00" }}>
                <td className="border-b border-r px-1 py-0.5 whitespace-nowrap" style={{ borderColor: "var(--g-grey-300)" }}>{riders[r.userId].name}</td>
                <td className="border-b px-1 py-0.5" style={{ borderColor: "var(--g-grey-300)" }}>{r.text}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="px-1 py-1 text-xs" style={{ color: "var(--g-grey-600)" }}>No responses for this question yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Name | Need Ride Going | Need Ride Back — people covered both ways are excluded. */
export function DiscrepancyTracker({ rows, riders }: {
  rows: { id: string; needGoing: boolean; needBack: boolean }[];
  riders: Record<string, Rider>;
}) {
  const sorted = [...rows].sort((a, b) => (riders[a.id]?.name ?? "").localeCompare(riders[b.id]?.name ?? ""));
  return (
    <div className="rounded border" style={{ borderColor: "var(--g-grey-300)" }}>
      <div className="px-2 py-1 text-sm font-semibold" style={{ background: "var(--g-grey-100)" }}>Discrepancy tracker</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--g-grey-600)" }}>
            <th className="border-b px-1 py-0.5 font-medium" style={{ borderColor: "var(--g-grey-300)" }}>Name</th>
            <th className="border-b px-1 py-0.5 font-medium" style={{ borderColor: "var(--g-grey-300)" }}>Need Ride Going</th>
            <th className="border-b px-1 py-0.5 font-medium" style={{ borderColor: "var(--g-grey-300)" }}>Need Ride Back</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td className="border-b px-1 py-0.5" style={{ borderColor: "var(--g-grey-300)" }}>{riders[r.id]?.name ?? "?"}</td>
              <td className="border-b px-1 py-0.5 text-center font-medium" style={{ borderColor: "var(--g-grey-300)", color: r.needGoing ? "var(--g-red)" : undefined }}>{r.needGoing ? 1 : ""}</td>
              <td className="border-b px-1 py-0.5 text-center font-medium" style={{ borderColor: "var(--g-grey-300)", color: r.needBack ? "var(--g-red)" : undefined }}>{r.needBack ? 1 : ""}</td>
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={3} className="px-1 py-1 text-xs" style={{ color: "var(--g-grey-600)" }}>No discrepancies — everyone is covered both ways 🎉</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
