"use client";

import { getSeat, lineupPaddlerIds, seatKey, sideWeights, ROWS, type Lineup, type Roster, type Seat } from "@db/lineup";

export type Sel = { kind: "seat"; seat: Seat } | { kind: "roster"; id: string } | null;

/** One boat, laid out like the standalone builder: head (name, seated count,
 * clear/delete), the left/right balance bar, the drummer and steer as pills, then
 * ten rows with the row number between the two sides. `showDiffs` adds that
 * builder's per-row left-vs-right weight gap column. */
export default function BoatCard({ name, lineup, roster, sel, onClickSeat, onRename, onClear, onRemove, showDiffs, canRemove }: {
  name: string;
  lineup: Lineup;
  roster: Roster;
  sel: Sel;
  onClickSeat: (s: Seat) => void;
  onRename: (v: string) => void;
  onClear: () => void;
  onRemove: () => void;
  showDiffs?: boolean;
  canRemove?: boolean;
}) {
  const sw = sideWeights(lineup, roster);
  const seated = lineupPaddlerIds(lineup).length;
  const total = sw.left + sw.right;
  const leftPct = total ? (sw.left / total) * 100 : 50;
  const gap = Math.abs(sw.diff);
  // The standalone builder ranks the imbalance rather than printing a bare number.
  const rank = !total ? "none" : gap <= 10 ? "ok" : gap <= 25 ? "warn" : "bad";
  const callout = !total ? "No weight yet" : gap === 0 ? "Even" : `${sw.diff > 0 ? "Left" : "Right"} +${gap.toFixed(0)} lb`;

  const seatProps = { lineup, roster, sel, onClick: onClickSeat };
  return (
    <section className="lu-boat">
      <div className="lu-head">
        <input className="lu-name" value={name} onChange={(e) => onRename(e.target.value)} aria-label="Boat name" />
        <span className="lu-size">{seated}/22</span>
        <span className="lu-acts">
          <button type="button" onClick={onClear} title="Clear all seats" className="btn-text py-0.5">Clear</button>
          {canRemove && <button type="button" onClick={onRemove} title="Delete boat" className="btn-text del py-0.5">Delete</button>}
        </span>
      </div>

      <div>
        <div className={`lu-callout lu-${rank}`}>{callout}</div>
        <div className="lu-bar">
          <i style={{ width: `${leftPct}%`, background: "#182B49" }} />
          <i style={{ width: `${100 - leftPct}%`, background: "#FFCD00" }} />
        </div>
        <div className="lu-legend">
          <span>Left {sw.left.toFixed(0)} lb</span>
          <span>Total {total.toFixed(0)} lb</span>
          <span>Right {sw.right.toFixed(0)} lb</span>
        </div>
      </div>

      <div className="lu-ends" style={showDiffs ? { paddingRight: "calc(56px + 8px)" } : undefined}>
        <div className="lu-end-label"><b>Drummer</b></div>
        <SeatBtn {...seatProps} seat={{ kind: "drummer" }} placeholder="Empty" />
      </div>

      {Array.from({ length: ROWS }, (_, row) => (
        <div key={row} className="lu-row">
          <SeatBtn {...seatProps} seat={{ kind: "seat", row, side: "left" }} placeholder="Empty" />
          <div className="lu-num">{row + 1}</div>
          <SeatBtn {...seatProps} seat={{ kind: "seat", row, side: "right" }} placeholder="Empty" />
          {showDiffs && <RowDiff lineup={lineup} roster={roster} row={row} />}
        </div>
      ))}

      <div className="lu-ends" style={showDiffs ? { paddingRight: "calc(56px + 8px)" } : undefined}>
        <div className="lu-end-label"><b>Steer</b></div>
        <SeatBtn {...seatProps} seat={{ kind: "steer" }} placeholder="Empty" />
      </div>
    </section>
  );
}

/** Which side of this row is heavier, and by how much. */
function RowDiff({ lineup, roster, row }: { lineup: Lineup; roster: Roster; row: number }) {
  const l = lineup.seats[row]?.[0], r = lineup.seats[row]?.[1];
  if (!l || !r) return <div className="lu-diff" aria-hidden />;
  const lw = roster[l]?.weight ?? 0, rw = roster[r]?.weight ?? 0;
  const d = Math.abs(lw - rw);
  if (!d) return <div className="lu-diff" title="Row is even">0</div>;
  const leftHeavier = lw > rw;
  return (
    <div className="lu-diff" title={`${leftHeavier ? "Left" : "Right"} side heavier by ${d.toFixed(0)} lb`}>
      {leftHeavier ? `← ${d.toFixed(0)}` : `${d.toFixed(0)} →`}
    </div>
  );
}

function SeatBtn({ seat, placeholder, lineup, roster, sel, onClick }: {
  seat: Seat; placeholder: string; lineup: Lineup; roster: Roster; sel: Sel; onClick: (s: Seat) => void;
}) {
  const pid = getSeat(lineup, seat);
  const p = pid ? roster[pid] : null;
  const selected = sel?.kind === "seat" && seatKey(sel.seat) === seatKey(seat);
  const target = sel?.kind === "roster" && !pid;
  const gender = p?.gender === "female" ? "g-women" : p ? "g-open" : "";
  const side = p?.sidePreference && p.sidePreference !== "either" ? p.sidePreference : null;
  return (
    <button type="button" onClick={() => onClick(seat)}
      className={`lu-seat ${pid ? gender : "empty"} ${selected ? "sel" : ""} ${target ? "target" : ""}`}
      title={p ? `${p.name} · ${p.weight || "?"} lb${side ? ` · prefers ${side}` : ""}` : undefined}>
      {p ? (
        <span className="min-w-0">
          <span className="nm block">{p.name}</span>
          <span className="sub">{p.weight ? `${p.weight.toFixed(0)} lb` : "no weight"}{side ? ` · ${side[0].toUpperCase()}` : ""}</span>
        </span>
      ) : pid ? <span className="nm">(left team)</span> : placeholder}
    </button>
  );
}
