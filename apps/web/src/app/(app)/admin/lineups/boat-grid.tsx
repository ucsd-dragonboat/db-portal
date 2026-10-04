"use client";

import { frontBackWeights, getSeat, lineupPaddlerIds, seatKey, sideWeights, ROWS, type Lineup, type Roster, type Seat } from "@db/lineup";

export type Sel = { kind: "seat"; seat: Seat } | { kind: "roster"; id: string } | null;

/** The 22-seat boat: drummer, ten rows of left/right, steer, plus the balance line.
 * Seats listed in `diffKeys` are highlighted — that's "show row differences". */
export default function BoatGrid({ lineup, roster, sel, onClickSeat, diffKeys }: {
  lineup: Lineup;
  roster: Roster;
  sel: Sel;
  onClickSeat: (s: Seat) => void;
  diffKeys?: Set<string>;
}) {
  const isSel = (seat: Seat) => sel?.kind === "seat" && seatKey(sel.seat) === seatKey(seat);
  const props = { lineup, roster, isSel, rosterSelected: sel?.kind === "roster", onClick: onClickSeat, diffKeys };
  const sw = sideWeights(lineup, roster);
  const fb = frontBackWeights(lineup, roster);
  const seated = lineupPaddlerIds(lineup).length;
  return (
    <div className="card overflow-x-auto">
      <div className="mx-auto w-max">
        <div className="flex justify-center"><SeatBtn {...props} seat={{ kind: "drummer" }} badge="C" /></div>
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="-mt-px flex items-center">
            <span className="sheet-label">{weightAt(lineup, roster, row, "left")}</span>
            <SeatBtn {...props} seat={{ kind: "seat", row, side: "left" }} badge={`${row + 1}L`} />
            <div className="-ml-px"><SeatBtn {...props} seat={{ kind: "seat", row, side: "right" }} badge={`${row + 1}R`} /></div>
            <span className="sheet-label">{weightAt(lineup, roster, row, "right")}</span>
          </div>
        ))}
        <div className="-mt-px flex justify-center"><SeatBtn {...props} seat={{ kind: "steer" }} badge="S" /></div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-slate-600">
        <span>Left: <b>{sw.left.toFixed(0)} lb</b></span>
        <span>Right: <b>{sw.right.toFixed(0)} lb</b></span>
        <span>L−R: <b className={Math.abs(sw.diff) > 30 ? "text-red-600" : ""}>{sw.diff > 0 ? "+" : ""}{sw.diff.toFixed(0)} lb</b></span>
        <span>Front−Back: <b>{fb.diff > 0 ? "+" : ""}{fb.diff.toFixed(0)} lb</b></span>
        <span>Seated: {seated}/22</span>
      </div>
    </div>
  );
}

function weightAt(lineup: Lineup, roster: Roster, row: number, side: "left" | "right"): string {
  const pid = lineup.seats[row]?.[side === "left" ? 0 : 1];
  const w = pid ? roster[pid]?.weight : null;
  return w ? w.toFixed(0) : "";
}

function SeatBtn({ seat, badge, lineup, roster, isSel, rosterSelected, onClick, diffKeys }: {
  seat: Seat; badge: string; lineup: Lineup; roster: Roster;
  isSel: (s: Seat) => boolean; rosterSelected: boolean; onClick: (s: Seat) => void; diffKeys?: Set<string>;
}) {
  const pid = getSeat(lineup, seat);
  const p = pid ? roster[pid] : null;
  const name = pid ? p?.name ?? "(left team)" : null;
  const side = p?.sidePreference && p.sidePreference !== "either" ? p.sidePreference[0].toUpperCase() : null;
  const differs = diffKeys?.has(seatKey(seat));
  return (
    <button type="button" onClick={() => onClick(seat)}
      title={p ? `${p.name} · ${p.weight || "?"} lb${side ? ` · prefers ${p.sidePreference}` : ""}` : undefined}
      className={`sheet-cell ${isSel(seat) ? "sheet-cell-sel" : ""} ${rosterSelected && !pid ? "sheet-cell-target" : ""}`}
      style={differs ? { background: "#fff7ed", boxShadow: "inset 0 0 0 2px #fb923c" } : undefined}>
      <span className="sheet-badge">{badge}</span>
      {name && <span className="sheet-name">{name}</span>}
    </button>
  );
}
