import type { Car, CarpoolDataV2, DirSet } from "@db/carpool";

type Names = Record<string, string>;
const who = (names: Names, id: string) => names[id] ?? "?";

function CarBox({ c, names }: { c: Car; names: Names }) {
  return (
    <div className={`w-40 shrink-0 rounded border ${c.capacity - 1 > 4 ? "border-2 border-black" : ""}`}
      style={c.capacity - 1 > 4 ? undefined : { borderColor: "var(--g-grey-300)" }}>
      <div className="truncate rounded-t px-2 py-1 text-sm font-medium text-white" style={{ background: "var(--g-red)" }}>
        🚗 {who(names, c.driverId)} <span className="text-xs opacity-80">({c.passengerIds.length}/{c.capacity - 1})</span>
      </div>
      <ol className="list-decimal px-2 py-1 pl-6 text-sm">
        {c.passengerIds.map((p) => <li key={p}>{who(names, p)}</li>)}
        {!c.passengerIds.length && <li className="list-none -ml-4 text-xs" style={{ color: "var(--g-grey-600)" }}>empty</li>}
      </ol>
    </div>
  );
}

function Grids({ dir, names }: { dir: DirSet; names: Names }) {
  return (
    <div className="space-y-2">
      {(["onCampus", "offCampus"] as const).map((k) => dir[k].length > 0 && (
        <div key={k}>
          <div className="mb-1 text-xs font-semibold" style={{ color: "var(--g-grey-600)" }}>{k === "onCampus" ? "ON CAMPUS" : "OFF CAMPUS"}</div>
          <div className="flex flex-wrap gap-2">{dir[k].map((c) => <CarBox key={c.id} c={c} names={names} />)}</div>
        </div>
      ))}
      {dir.diy.length > 0 && (
        <div className="text-sm"><span className="mr-1 rounded px-1 text-xs font-semibold" style={{ background: "#d6ccfe" }}>DIY</span>{dir.diy.map((p) => who(names, p)).join(", ")}</div>
      )}
      {!dir.onCampus.length && !dir.offCampus.length && !dir.diy.length && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Nothing assigned yet.</p>}
    </div>
  );
}

/** Member-facing (read-only) render of the rides sheet: banner, GOING/BACK with
 * on/off-campus car boxes and DIY lists. Server component — no client JS. */
export default function CarpoolSheetView({ data, names }: { data: CarpoolDataV2; names: Names }) {
  return (
    <div className="space-y-3">
      <div className="rounded px-3 py-1.5 text-center text-sm font-semibold text-white" style={{ background: "#2f2f2f" }}>{data.header}</div>
      <div><div className="mb-1 text-sm font-semibold" style={{ color: "var(--g-red)" }}>GOING ➡️</div><Grids dir={data.going} names={names} /></div>
      <div><div className="mb-1 text-sm font-semibold" style={{ color: "var(--g-red)" }}>BACK ⬅️</div><Grids dir={data.back} names={names} /></div>
    </div>
  );
}
