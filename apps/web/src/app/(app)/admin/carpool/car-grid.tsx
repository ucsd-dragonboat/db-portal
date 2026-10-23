"use client";

import type { Car, DirSet, PlaceTarget, Rider } from "@db/carpool";
import NameCell, { type NameOption } from "./name-cell";
import { textOn } from "@db/carpool";
import { colorBar, useSheetColors } from "./sheet-colors";

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
  /** Drag a car left/right (or to the other campus band): before `beforeCarId`, or the band's end. */
  moveCar: (dir: DirKey, carId: string, band: "onCampus" | "offCampus", beforeCarId: string | null) => void;
  /** Someone dropped on a car's driver cell takes it over; the old driver takes their spot. */
  swapDriver: (dir: DirKey, carId: string, riderId: string) => void;
  setComment: (dir: DirKey, carId: string, comment: string) => void;
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
/** Drag payloads are "<kind>:<id>:<origin>" — "rider:<riderId>:<going|back|roster>" or
 * "car:<carId>:<going|back>". Ids can contain ":" themselves (car "g:<driver>", write-in
 * "x:<random>"), so the id is everything between the first and last segment. */
export function parseDrag(payload: string): { kind: string; id: string; origin: string } {
  const parts = payload.split(":");
  return { kind: parts[0] ?? "", id: parts.slice(1, -1).join(":"), origin: parts.at(-1) ?? "" };
}

/** Drop on a car's driver cell: a car moves before it; a person takes over as its driver. */
function dropOnDriver(dir: DirKey, band: "onCampus" | "offCampus", car: Car, payload: string, h: GridHandlers) {
  const { kind, id, origin } = parseDrag(payload);
  if (kind === "car" && origin === dir) h.moveCar(dir, id, band, car.id);
  else if (kind === "rider" && id) h.swapDriver(dir, car.id, id);
}

function CarColumn({ dir, band, car, riders, options, rows, h, highlight }: {
  dir: DirKey; band: "onCampus" | "offCampus"; car: Car; riders: Record<string, Rider>; options: NameOption[]; rows: number; h: GridHandlers;
  /** Passengers shown light blue (off-campus people in an on-campus car). */
  highlight?: Set<string>;
}) {
  const ctx = useSheetColors();
  const seats = car.capacity - 1;
  const wide = seats > 4;
  const cols = wide ? 2 : 1;
  const cells = Array.from({ length: rows * cols }, (_, i) => i);
  return (
    <div className="shrink-0" style={{ width: cols * 100, outline: wide ? "2px solid #000" : undefined, outlineOffset: -1, zIndex: wide ? 1 : undefined }}>
      <div className="group flex h-[22px] items-center gap-0.5 px-1 text-[13px]" style={{ background: ctx.c.driver, color: textOn(ctx.c.driver), ...cellBorder }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); dropOnDriver(dir, band, car, e.dataTransfer.getData("text/plain"), h); }}>
        <span draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `car:${car.id}:${dir}`)}
          className="min-w-0 flex-1 cursor-grab truncate font-medium"
          title={`${riders[car.driverId]?.name ?? ""} — drag to move this car; drop a person here to make them the driver`}>{riders[car.driverId]?.name ?? "?"}</span>
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
              highlightColor={pid && highlight?.has(pid) ? ctx.c.highlight : undefined}
            />
          );
        })}
      </div>
      <input value={car.comment ?? ""} onChange={(e) => h.setComment(dir, car.id, e.target.value)} maxLength={500}
        placeholder="comment" title={car.comment || "A note for this car — copied with the rides"}
        className="block h-[22px] w-full bg-white px-1 text-[12px] italic outline-none placeholder:text-black/25 focus:bg-[#fffbe6]" style={cellBorder} />
    </div>
  );
}

/** An empty spreadsheet column: typeable pink Driver cell (creates the car) over
 * blank white cells — so the band always looks like the sheet's empty grid. */
function EmptyColumn({ dir, band, driverOptions, rows, h }: {
  dir: DirKey; band: "onCampus" | "offCampus"; driverOptions: NameOption[]; rows: number; h: GridHandlers;
}) {
  const { c } = useSheetColors();
  return (
    <div className="w-[100px] shrink-0">
      <NameCell value={null} options={driverOptions} onPick={(id) => h.addDriver(dir, band, id)}
        onDropRider={(payload) => {
          const { kind: k, id, origin } = parseDrag(payload);
          if (k === "rider") h.addDriver(dir, band, id);
          else if (k === "car" && origin === dir) h.moveCar(dir, id, band, null); // to the end of this band
        }}
        highlightColor={c.driver} />
      {Array.from({ length: rows + 1 }, (_, i) => <div key={i} className="h-[22px] bg-white" style={cellBorder} />)}
    </div>
  );
}

/** One campus band of a direction: tan header row (with the red GOING/BACK cell on
 * the first band), then the "Driver" pink label column + flush car columns, padded
 * with empty typeable columns so the grid always looks like the sheet. */
export function CarGrid({ dir, band, label, directionLabel, cars, riders, options, driverOptions, h, highlight }: {
  dir: DirKey; band: "onCampus" | "offCampus"; label: string; directionLabel?: string; cars: Car[];
  riders: Record<string, Rider>; options: NameOption[]; driverOptions: NameOption[]; h: GridHandlers;
  /** Off-campus people: light blue when they're a passenger here (on-campus band only). */
  highlight?: Set<string>;
}) {
  const rows = Math.max(4, ...cars.map((c) => Math.ceil((c.capacity - 1) / (c.capacity - 1 > 4 ? 2 : 1))));
  const usedCols = cars.reduce((n, c) => n + (c.capacity - 1 > 4 ? 2 : 1), 0);
  const emptyCols = Math.max(1, 6 - usedCols); // pad to ≥6 columns like the sheet, always ≥1 open
  const ctx = useSheetColors();
  const bandKey = dir === "back" ? "bandBack" : "band";
  return (
    <div className="text-[13px]" style={{ borderLeft: `1px solid ${SHEET.grid}`, borderTop: `1px solid ${SHEET.grid}` }}>
      <div className="flex">
        {directionLabel
          ? <div {...colorBar(ctx, "direction")} className="flex h-[22px] w-20 shrink-0 items-center px-1 font-medium" style={{ ...colorBar(ctx, "direction").style, ...cellBorder }}>{directionLabel}</div>
          : <div className="h-[22px] w-20 shrink-0 bg-white" style={cellBorder} />}
        <div {...colorBar(ctx, bandKey)} className="flex h-[22px] flex-1 items-center justify-center font-medium" style={{ ...colorBar(ctx, bandKey).style, ...cellBorder }}>{label}</div>
      </div>
      <div className="flex">
        <div className="w-20 shrink-0">
          <div {...colorBar(ctx, "driver")} className="flex h-[22px] items-center px-1" style={{ ...colorBar(ctx, "driver").style, ...cellBorder }}>Driver</div>
          <div {...colorBar(ctx, "filler")} style={{ ...colorBar(ctx, "filler").style, height: rows * 22, ...cellBorder }} />
          <div {...colorBar(ctx, "filler")} className="flex h-[22px] items-center px-1 text-[12px] italic" style={{ ...colorBar(ctx, "filler").style, ...cellBorder }}>Comment</div>
        </div>
        {cars.map((c) => <CarColumn key={c.id} dir={dir} band={band} car={c} riders={riders} options={options} rows={rows} h={h} highlight={band === "onCampus" ? highlight : undefined} />)}
        {Array.from({ length: emptyCols }, (_, i) => <EmptyColumn key={`e${i}`} dir={dir} band={band} driverOptions={driverOptions} rows={rows} h={h} />)}
      </div>
    </div>
  );
}

/** DIY band: purple header, then a white free-placement row. */
export function DiyRow({ dir, dirSet, riders, options, h }: {
  dir: DirKey; dirSet: DirSet; riders: Record<string, Rider>; options: NameOption[]; h: GridHandlers;
}) {
  const ctx = useSheetColors();
  return (
    <div className="text-[13px]" style={{ borderLeft: `1px solid ${SHEET.grid}` }}>
      <div className="flex">
        <div {...colorBar(ctx, "diy")} className="h-[22px] w-20 shrink-0" style={{ ...colorBar(ctx, "diy").style, ...cellBorder }} />
        <div {...colorBar(ctx, "diy")} className="flex h-[22px] flex-1 items-center justify-center font-medium" style={{ ...colorBar(ctx, "diy").style, ...cellBorder }}>DIY</div>
      </div>
      <div className="flex flex-wrap bg-white"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); h.drop(dir, { kind: "diy" }, e.dataTransfer.getData("text/plain")); }}>
        <div {...colorBar(ctx, "filler")} className="w-20 shrink-0 self-stretch" style={{ ...colorBar(ctx, "filler").style, ...cellBorder }} />
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
