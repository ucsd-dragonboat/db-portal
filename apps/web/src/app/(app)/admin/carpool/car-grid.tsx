"use client";

import type { Car, DirSet, PlaceTarget, Rider } from "@db/carpool";
import NameCell, { type NameOption } from "./name-cell";

export type DirKey = "going" | "back";

export type GridHandlers = {
  place: (dir: DirKey, target: PlaceTarget, riderId: string) => void;
  unseat: (dir: DirKey, riderId: string) => void;
  /** Payload "rider:<id>:<origin>" dropped somewhere in direction `dir`. */
  drop: (dir: DirKey, target: PlaceTarget, payload: string) => void;
  setCap: (dir: DirKey, carId: string, cap: number) => void;
  toggleLock: (dir: DirKey, carId: string) => void;
  /** Typing/dropping someone into an empty Driver cell creates their car in `band`. */
  addDriver: (dir: DirKey, band: "onCampus" | "offCampus", riderId: string) => void;
  removeCar: (dir: DirKey, carId: string) => void;
};

// Exact colors from the team's Google Sheets template.
export const SHEET = {
  grid: "#e0e0e0", banner: "#2f2f2f", direction: "#e80b0b", band: "#ffefbf", bandBack: "#ffeebf",
  driver: "#fecccc", filler: "#d9d9d9", diy: "#d6ccfe", sep: "#666666", warn: "#ff7c3a",
};
const cellBorder = { borderRight: `1px solid ${SHEET.grid}`, borderBottom: `1px solid ${SHEET.grid}` };

const opt = (riders: Record<string, Rider>, id: string): NameOption => ({ id, name: riders[id]?.name ?? "?" });

/** One car as spreadsheet columns: pink driver cell on top, white passenger cells
 * below. Cars with more than 4 passenger seats take two columns inside a black box. */
function CarColumn({ dir, car, riders, options, rows, h }: {
  dir: DirKey; car: Car; riders: Record<string, Rider>; options: NameOption[]; rows: number; h: GridHandlers;
}) {
  const seats = car.capacity - 1;
  const wide = seats > 4;
  const cols = wide ? 2 : 1;
  const cells = Array.from({ length: rows * cols }, (_, i) => i);
  return (
    <div className="shrink-0" style={{ width: cols * 100, outline: wide ? "2px solid #000" : undefined, outlineOffset: -1, zIndex: wide ? 1 : undefined }}>
      <div className="group flex h-[22px] items-center gap-0.5 px-1 text-[13px]" style={{ background: SHEET.driver, ...cellBorder }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); h.drop(dir, { kind: "car", carId: car.id }, e.dataTransfer.getData("text/plain")); }}>
        <span className="min-w-0 flex-1 truncate font-medium" title={riders[car.driverId]?.name}>{riders[car.driverId]?.name ?? "?"}</span>
        <input type="number" min={1} max={15} value={car.capacity} onChange={(e) => h.setCap(dir, car.id, Number(e.target.value))}
          className="w-8 rounded-sm bg-white/60 px-0.5 text-center text-[11px] outline-none" title="Capacity incl. driver" />
        <button type="button" onClick={() => h.toggleLock(dir, car.id)}
          className={`text-[12px] ${car.locked ? "" : "opacity-30 grayscale hover:opacity-70"}`}
          title={car.locked ? "Locked — Optimize won't touch this car (click to unlock)" : "Unlocked — Optimize may rearrange this car (click to lock)"}>
          {car.locked ? "🔒" : "🔓"}
        </button>
        <button type="button" onClick={() => h.removeCar(dir, car.id)} tabIndex={-1} className="hidden text-[11px] text-black/40 hover:text-red-700 group-hover:inline" title="Remove this car (passengers become unplaced)">✕</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map((i) => {
          if (i >= seats) return <NameCell key={i} value={null} options={[]} onPick={() => {}} disabled />;
          const pid = car.passengerIds[i] ?? null;
          return (
            <NameCell key={i}
              value={pid ? opt(riders, pid) : null}
              options={options}
              onPick={(id) => h.place(dir, { kind: "car", carId: car.id }, id)}
              onClear={pid ? () => h.unseat(dir, pid) : undefined}
              dragPayload={pid ? `rider:${pid}:${dir}` : undefined}
              onDropRider={(payload) => h.drop(dir, { kind: "car", carId: car.id }, payload)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** An empty spreadsheet column: typeable pink Driver cell (creates the car) over
 * blank white cells — so the band always looks like the sheet's empty grid. */
function EmptyColumn({ dir, band, driverOptions, rows, h }: {
  dir: DirKey; band: "onCampus" | "offCampus"; driverOptions: NameOption[]; rows: number; h: GridHandlers;
}) {
  return (
    <div className="w-[100px] shrink-0">
      <NameCell value={null} options={driverOptions} onPick={(id) => h.addDriver(dir, band, id)}
        onDropRider={(payload) => { const [k, id] = payload.split(":"); if (k === "rider") h.addDriver(dir, band, id); }}
        className="!bg-[#fecccc]" />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-[22px] bg-white" style={cellBorder} />)}
    </div>
  );
}

/** One campus band of a direction: tan header row (with the red GOING/BACK cell on
 * the first band), then the "Driver" pink label column + flush car columns, padded
 * with empty typeable columns so the grid always looks like the sheet. */
export function CarGrid({ dir, band, label, directionLabel, cars, riders, options, driverOptions, h }: {
  dir: DirKey; band: "onCampus" | "offCampus"; label: string; directionLabel?: string; cars: Car[];
  riders: Record<string, Rider>; options: NameOption[]; driverOptions: NameOption[]; h: GridHandlers;
}) {
  const rows = Math.max(4, ...cars.map((c) => Math.ceil((c.capacity - 1) / (c.capacity - 1 > 4 ? 2 : 1))));
  const usedCols = cars.reduce((n, c) => n + (c.capacity - 1 > 4 ? 2 : 1), 0);
  const emptyCols = Math.max(1, 6 - usedCols); // pad to ≥6 columns like the sheet, always ≥1 open
  return (
    <div className="text-[13px]" style={{ borderLeft: `1px solid ${SHEET.grid}`, borderTop: `1px solid ${SHEET.grid}` }}>
      <div className="flex">
        <div className="flex h-[22px] w-20 shrink-0 items-center px-1 font-medium text-white" style={{ background: directionLabel ? SHEET.direction : "#fff", ...cellBorder }}>
          {directionLabel ?? ""}
        </div>
        <div className="flex h-[22px] flex-1 items-center justify-center font-medium" style={{ background: dir === "back" ? SHEET.bandBack : SHEET.band, ...cellBorder }}>{label}</div>
      </div>
      <div className="flex">
        <div className="w-20 shrink-0">
          <div className="flex h-[22px] items-center px-1" style={{ background: SHEET.driver, ...cellBorder }}>Driver</div>
          <div style={{ background: SHEET.filler, height: rows * 22, ...cellBorder }} />
        </div>
        {cars.map((c) => <CarColumn key={c.id} dir={dir} car={c} riders={riders} options={options} rows={rows} h={h} />)}
        {Array.from({ length: emptyCols }, (_, i) => <EmptyColumn key={`e${i}`} dir={dir} band={band} driverOptions={driverOptions} rows={rows} h={h} />)}
      </div>
    </div>
  );
}

/** DIY band: purple header, then a white free-placement row. */
export function DiyRow({ dir, dirSet, riders, options, h }: {
  dir: DirKey; dirSet: DirSet; riders: Record<string, Rider>; options: NameOption[]; h: GridHandlers;
}) {
  return (
    <div className="text-[13px]" style={{ borderLeft: `1px solid ${SHEET.grid}` }}>
      <div className="flex">
        <div className="h-[22px] w-20 shrink-0" style={{ background: SHEET.diy, ...cellBorder }} />
        <div className="flex h-[22px] flex-1 items-center justify-center font-medium" style={{ background: SHEET.diy, ...cellBorder }}>DIY</div>
      </div>
      <div className="flex flex-wrap bg-white"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); h.drop(dir, { kind: "diy" }, e.dataTransfer.getData("text/plain")); }}>
        <div className="w-20 shrink-0 self-stretch" style={{ background: SHEET.filler, ...cellBorder }} />
        {dirSet.diy.map((pid) => (
          <NameCell key={pid} value={opt(riders, pid)} options={[]} onPick={() => {}}
            onClear={() => h.unseat(dir, pid)} dragPayload={`rider:${pid}:${dir}`} className="w-[100px]" />
        ))}
        {/* pad with typeable cells so the row reads like the sheet's empty grid */}
        {Array.from({ length: Math.max(1, 6 - dirSet.diy.length) }, (_, i) => (
          <NameCell key={`e${i}`} value={null} options={options} onPick={(id) => h.place(dir, { kind: "diy" }, id)}
            onDropRider={(payload) => h.drop(dir, { kind: "diy" }, payload)} className="w-[100px]" />
        ))}
      </div>
    </div>
  );
}
