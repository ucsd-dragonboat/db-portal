import type { Car, CarpoolDataV2, DirSet } from "@db/carpool";

// Read-only member render of the rides sheet, in the Google Sheets template's exact
// colors so it looks like the sheet everyone already knows. Server component.

type Names = Record<string, string>;
const GRID = "#e0e0e0";
const cellStyle = { borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` };
const cell = "flex h-[22px] items-center px-1 text-[13px]";
const who = (names: Names, id: string) => names[id] ?? "?";

function CarColumn({ c, names, rows }: { c: Car; names: Names; rows: number }) {
  const seats = c.capacity - 1;
  const wide = seats > 4;
  const cols = wide ? 2 : 1;
  const cells = Array.from({ length: rows * cols }, (_, i) => i);
  return (
    <div className="shrink-0" style={{ width: cols * 100, outline: wide ? "2px solid #000" : undefined, outlineOffset: -1, zIndex: wide ? 1 : undefined }}>
      <div className={`${cell} truncate font-medium`} style={{ background: "#fecccc", ...cellStyle }} title={who(names, c.driverId)}>{who(names, c.driverId)}</div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map((i) => (
          <div key={i} className={`${cell} truncate`} style={{ background: i >= seats ? "#f3f3f3" : "#fff", ...cellStyle }}>
            {i < seats && c.passengerIds[i] ? who(names, c.passengerIds[i]) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function Band({ dir, label, directionLabel, cars, names }: { dir: "going" | "back"; label: string; directionLabel?: string; cars: Car[]; names: Names }) {
  const rows = Math.max(4, ...cars.map((c) => Math.ceil((c.capacity - 1) / (c.capacity - 1 > 4 ? 2 : 1))));
  return (
    <div style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex">
        <div className={`${cell} w-20 shrink-0 font-medium text-white`} style={{ background: directionLabel ? "#e80b0b" : "#fff", ...cellStyle }}>{directionLabel ?? ""}</div>
        <div className={`${cell} flex-1 justify-center font-medium`} style={{ background: dir === "back" ? "#ffeebf" : "#ffefbf", ...cellStyle }}>{label}</div>
      </div>
      <div className="flex">
        <div className="w-20 shrink-0">
          <div className={cell} style={{ background: "#fecccc", ...cellStyle }}>Driver</div>
          <div style={{ background: "#d9d9d9", height: rows * 22, ...cellStyle }} />
        </div>
        {cars.map((c) => <CarColumn key={c.id} c={c} names={names} rows={rows} />)}
        {!cars.length && <div className={`${cell} flex-1 bg-white text-xs`} style={{ color: "var(--g-grey-600)", ...cellStyle }}>no cars</div>}
      </div>
    </div>
  );
}

function Direction({ dir, dirKey, label, names }: { dir: DirSet; dirKey: "going" | "back"; label: string; names: Names }) {
  return (
    <div>
      <Band dir={dirKey} label="ON CAMPUS" directionLabel={label} cars={dir.onCampus} names={names} />
      <Band dir={dirKey} label="OFF CAMPUS" cars={dir.offCampus} names={names} />
      {dir.diy.length > 0 && (
        <div style={{ borderLeft: `1px solid ${GRID}` }}>
          <div className="flex">
            <div className={`${cell} w-20 shrink-0`} style={{ background: "#d6ccfe", ...cellStyle }} />
            <div className={`${cell} flex-1 justify-center font-medium`} style={{ background: "#d6ccfe", ...cellStyle }}>DIY</div>
          </div>
          <div className={`${cell} bg-white`} style={cellStyle}>{dir.diy.map((p) => who(names, p)).join(", ")}</div>
        </div>
      )}
    </div>
  );
}

export default function CarpoolSheetView({ data, names }: { data: CarpoolDataV2; names: Names }) {
  return (
    <div className="overflow-x-auto">
      <div className="w-max min-w-full">
        <div className="px-3 py-1.5 text-center text-[16px] font-medium text-white" style={{ background: "#2f2f2f" }}>{data.header}</div>
        <Direction dir={data.going} dirKey="going" label="GOING ➡️" names={names} />
        <div className="h-3" />
        <Direction dir={data.back} dirKey="back" label="BACK ⬅️" names={names} />
      </div>
    </div>
  );
}
