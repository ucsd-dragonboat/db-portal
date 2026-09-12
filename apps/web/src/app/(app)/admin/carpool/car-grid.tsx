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
};

const opt = (riders: Record<string, Rider>, id: string): NameOption => ({ id, name: riders[id]?.name ?? "?" });

/** One car as a spreadsheet column: red driver cell on top, passenger cells below.
 * Cars with more than 4 passenger seats take two columns inside a black box. */
function CarColumn({ dir, car, riders, options, h }: {
  dir: DirKey; car: Car; riders: Record<string, Rider>; options: NameOption[]; h: GridHandlers;
}) {
  const seats = car.capacity - 1;
  const cols = seats > 4 ? 2 : 1;
  const rows = Math.max(4, Math.ceil(seats / cols));
  const cells = Array.from({ length: rows * cols }, (_, i) => i);
  return (
    <div className={`w-${cols === 2 ? "[16rem]" : "32"} shrink-0 ${cols === 2 ? "border-2 border-black" : ""}`}
      style={{ width: cols === 2 ? "16rem" : "8rem" }}>
      <div className="flex items-center gap-1 px-1 py-1 text-sm text-white" style={{ background: "var(--g-red)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); h.drop(dir, { kind: "car", carId: car.id }, e.dataTransfer.getData("text/plain")); }}>
        <span className="min-w-0 flex-1 truncate font-medium" title={riders[car.driverId]?.name}>{riders[car.driverId]?.name ?? "?"}</span>
        <input type="number" min={1} max={15} value={car.capacity} onChange={(e) => h.setCap(dir, car.id, Number(e.target.value))}
          className="w-9 rounded bg-white/20 px-0.5 text-center text-xs text-white outline-none" title="Capacity incl. driver" />
        <button type="button" onClick={() => h.toggleLock(dir, car.id)} className="text-xs" title="Lock: optimizer won't change this car">{car.locked ? "🔒" : "🔓"}</button>
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

/** A labeled band of car columns (ON CAMPUS / OFF CAMPUS). */
export function CarGrid({ dir, label, cars, riders, options, h }: {
  dir: DirKey; label: string; cars: Car[]; riders: Record<string, Rider>; options: NameOption[]; h: GridHandlers;
}) {
  return (
    <div>
      <div className="px-2 py-0.5 text-center text-xs font-semibold" style={{ background: "#ffefbf" }}>{label}</div>
      {cars.length ? (
        <div className="flex flex-wrap gap-2 border p-2" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-grey-50)" }}>
          {cars.map((c) => <CarColumn key={c.id} dir={dir} car={c} riders={riders} options={options} h={h} />)}
        </div>
      ) : (
        <p className="border p-2 text-xs" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>No cars here.</p>
      )}
    </div>
  );
}

/** DIY strip: self-transport people, free placement. */
export function DiyRow({ dir, dirSet, riders, options, h }: {
  dir: DirKey; dirSet: DirSet; riders: Record<string, Rider>; options: NameOption[]; h: GridHandlers;
}) {
  return (
    <div>
      <div className="px-2 py-0.5 text-center text-xs font-semibold" style={{ background: "#d6ccfe" }}>DIY</div>
      <div className="flex flex-wrap items-center gap-1 border p-2" style={{ borderColor: "var(--g-grey-300)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); h.drop(dir, { kind: "diy" }, e.dataTransfer.getData("text/plain")); }}>
        {dirSet.diy.map((pid) => (
          <NameCell key={pid} value={opt(riders, pid)} options={[]} onPick={() => {}}
            onClear={() => h.unseat(dir, pid)} dragPayload={`rider:${pid}:${dir}`} className="w-32 !border" />
        ))}
        <NameCell value={null} options={options} onPick={(id) => h.place(dir, { kind: "diy" }, id)}
          onDropRider={(payload) => h.drop(dir, { kind: "diy" }, payload)} className="w-32 !border" />
      </div>
    </div>
  );
}
