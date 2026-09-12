"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  addDriverToDirSet, assignCarpool, buildOsrmRouteUrl, carRoutePoints, discrepancies, groupNeedsRide,
  locationKey, mirrorDirSet, parseOsrmRoute, placeInDirSet, reconcileDirSet, removeCarFromDirSet,
  removeFromDirSet, splitByCampus, upgradeCarpoolData,
  type CarpoolDataV2, type Destination, type MatchText, type OsrmRoute, type Rider,
} from "@db/carpool";
import { saveCarpool } from "./actions";
import { CarGrid, DiyRow, SHEET, type DirKey, type GridHandlers } from "./car-grid";
import { DiscrepancyTracker, FunFactPanel, TotalPanel } from "./side-panels";

const RouteMap = dynamic(() => import("@/components/route-map"), { ssr: false });

export type SavedCarpool = { data: unknown; published: boolean };
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

/** Sheets-style rides workspace: GOING/BACK sections of ON/OFF-CAMPUS car columns
 * + DIY, TOTAL roster with campus grouping, fun-fact column, discrepancy tracker.
 * destination === null → Optimize and the route map are disabled. */
export default function CarpoolBuilder({ eventId, destination, riders, drivers, needsRide, saved, pickupNames, funFactQuestions, funFactAnswers }: {
  eventId: string; destination: Destination | null; riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[]; needsRide: string[]; saved: SavedCarpool | null;
  pickupNames: Record<string, string>;
  funFactQuestions: { id: string; label: string }[];
  funFactAnswers: Record<string, { userId: string; text: string }[]>;
}) {
  const matchText = useMemo<MatchText>(
    () => Object.fromEntries(Object.values(riders).map((r) => [r.id, `${r.name} ${pickupNames[r.id] ?? ""}`])),
    [riders, pickupNames],
  );
  const riderIdSet = useMemo(() => new Set(Object.keys(riders)), [riders]);

  const initial = useMemo<CarpoolDataV2>(() => {
    const up = upgradeCarpoolData(saved?.data, matchText);
    return {
      ...up,
      going: reconcileDirSet(up.going, drivers, riderIdSet, matchText, up.collegeKeywords, "g"),
      back: reconcileDirSet(up.back, drivers, riderIdSet, matchText, up.collegeKeywords, "b"),
    };
  }, [saved, drivers, riderIdSet, matchText]);

  const [data, setData] = useState<CarpoolDataV2>(initial);
  const [routes, setRoutes] = useState<Record<string, OsrmRoute | null>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const placedGoing = useMemo(() => placedSet(data.going), [data.going]);
  const placedBack = useMemo(() => placedSet(data.back), [data.back]);
  const driverIdSet = useMemo(() => new Set(drivers.map((d) => d.id)), [drivers]);
  // TOTAL "DIY" column: people who RSVP'd but neither drive nor need a ride.
  const selfIds = useMemo(
    () => Object.keys(riders).filter((id) => !driverIdSet.has(id) && !needsRide.includes(id)),
    [riders, driverIdSet, needsRide],
  );
  const grouped = useMemo(() => groupNeedsRide(needsRide, matchText, data.collegeKeywords), [needsRide, matchText, data.collegeKeywords]);
  const disc = useMemo(() => discrepancies(needsRide, data.going, data.back), [needsRide, data.going, data.back]);
  const options = useMemo(() => {
    const all = Object.values(riders).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
    const drivingIn = (d: CarpoolDataV2["going"]) => new Set([...d.onCampus, ...d.offCampus].map((c) => c.driverId));
    const dg = drivingIn(data.going), db = drivingIn(data.back);
    return {
      going: all.filter((o) => !placedGoing.has(o.id) && !dg.has(o.id)),
      back: all.filter((o) => !placedBack.has(o.id) && !db.has(o.id)),
      // empty Driver cells: anyone not already driving in that direction
      goingDrivers: all.filter((o) => !dg.has(o.id)),
      backDrivers: all.filter((o) => !db.has(o.id)),
    };
  }, [riders, placedGoing, placedBack, data.going, data.back]);

  const setDir = (dir: DirKey, f: (d: CarpoolDataV2[DirKey]) => CarpoolDataV2[DirKey]) =>
    setData((s) => ({ ...s, [dir]: f(s[dir]) }));

  const h: GridHandlers = {
    place: (dir, target, riderId) => setDir(dir, (d) => {
      const r = placeInDirSet(d, target, riderId);
      if (r.error === "full") setMsg("Car is full");
      return r.dir;
    }),
    unseat: (dir, riderId) => setDir(dir, (d) => removeFromDirSet(d, riderId)),
    drop: (dir, target, payload) => {
      const [kind, id] = payload.split(":");
      if (kind !== "rider" || !riders[id]) return;
      h.place(dir, target, id);
    },
    setCap: (dir, carId, cap) => setDir(dir, (d) => mapCarsIn(d, (c) => (c.id === carId ? { ...c, capacity: Math.max(1, cap) } : c))),
    toggleLock: (dir, carId) => setDir(dir, (d) => mapCarsIn(d, (c) => (c.id === carId ? { ...c, locked: !c.locked } : c))),
    addDriver: (dir, band, riderId) => setDir(dir, (d) =>
      addDriverToDirSet(d, band, riderId, drivers.find((x) => x.id === riderId)?.seats ?? 5, dir === "going" ? "g" : "b")),
    removeCar: (dir, carId) => setDir(dir, (d) => removeCarFromDirSet(d, carId)),
  };
  const unseatDrop = (payload: string) => {
    const [kind, id, origin] = payload.split(":");
    if (kind !== "rider" || (origin !== "going" && origin !== "back")) return;
    h.unseat(origin as DirKey, id);
  };
  const placedNote = (id: string) => {
    const g = placedGoing.has(id), b = placedBack.has(id);
    return g || b ? ` · ${g ? "G" : ""}${b ? "B" : ""}` : "";
  };

  const optimize = () => {
    if (!destination) return;
    const cars = [...data.going.onCampus, ...data.going.offCampus];
    const eligible: Record<string, Rider> = {};
    for (const id of needsRide) if (!placedGoing.has(id)) eligible[id] = riders[id];
    for (const c of cars) for (const p of c.passengerIds) eligible[p] = riders[p]; // keep manual placements
    const res = assignCarpool(cars, eligible, destination, { mode: "pickup" });
    setDir("going", (d) => ({ ...splitByCampus(res.cars, matchText, data.collegeKeywords), diy: d.diy }));
    setMsg(res.unassigned.length ? `${res.unassigned.length} rider(s) unassigned (no address or cars full)` : "Assigned");
  };

  const copyGoingToBack = () => {
    if (placedSet(data.back).size && !confirm("Overwrite the BACK section with a copy of GOING?")) return;
    setData((s) => ({ ...s, back: mirrorDirSet(s.going) }));
    setMsg("Copied Going → Back — edit Back freely, they're independent now");
  };

  const save = (published: boolean) => start(async () => {
    const r = await saveCarpool(eventId, data, published);
    setMsg("error" in r && r.error ? r.error : published ? "Saved & published to members" : "Saved draft");
  });

  // OSRM routes for the GOING cars only — debounced, and only refetched for cars
  // whose route points actually changed (public demo server; be gentle).
  const routeCache = useRef(new Map<string, { key: string; route: OsrmRoute | null }>());
  const goingCars = useMemo(() => [...data.going.onCampus, ...data.going.offCampus], [data.going]);
  const routeSig = useMemo(() => {
    if (!destination) return "";
    return JSON.stringify(goingCars.map((c) => [c.id, carRoutePoints(c, riders, destination, "pickup").map(locationKey).join("|")]));
  }, [goingCars, riders, destination]);
  useEffect(() => {
    if (!destination) return; // routes stays {} — destination never changes per page
    let cancelled = false;
    const t = setTimeout(async () => {
      const next: Record<string, OsrmRoute | null> = {};
      for (const c of goingCars) {
        const pts = carRoutePoints(c, riders, destination, "pickup");
        const key = pts.map(locationKey).join("|");
        const cached = routeCache.current.get(c.id);
        if (cached && cached.key === key) { next[c.id] = cached.route; continue; }
        if (pts.length < 2) { next[c.id] = null; routeCache.current.set(c.id, { key, route: null }); continue; }
        try {
          const r = await fetch(buildOsrmRouteUrl(pts));
          next[c.id] = parseOsrmRoute(await r.json());
        } catch { next[c.id] = null; }
        routeCache.current.set(c.id, { key, route: next[c.id] });
        if (cancelled) return;
      }
      if (!cancelled) setRoutes(next);
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig]);

  const mapCars = destination
    ? goingCars.map((c, i) => ({ id: c.id, color: COLORS[i % COLORS.length], points: carRoutePoints(c, riders, destination, "pickup"), route: routes[c.id] ?? null, label: riders[c.driverId]?.name ?? "?" }))
    : [];

  const dirSection = (dir: DirKey, label: string) => {
    const dOpts = dir === "going" ? options.goingDrivers : options.backDrivers;
    return (
      <section>
        <CarGrid dir={dir} band="onCampus" label="ON CAMPUS" directionLabel={label} cars={data[dir].onCampus} riders={riders} options={options[dir]} driverOptions={dOpts} h={h} />
        <CarGrid dir={dir} band="offCampus" label="OFF CAMPUS" cars={data[dir].offCampus} riders={riders} options={options[dir]} driverOptions={dOpts} h={h} />
        <DiyRow dir={dir} dirSet={data[dir]} riders={riders} options={options[dir]} h={h} />
      </section>
    );
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={optimize} disabled={!destination} title={destination ? "Auto-assign the Going section" : "Needs the day's location coordinates"} className="btn-primary py-1 disabled:cursor-not-allowed">Optimize</button>
        <button type="button" onClick={copyGoingToBack} className="btn-secondary py-1">Copy Going → Back</button>
        <button type="button" onClick={() => save(false)} disabled={pending} className="btn-secondary py-1">Save</button>
        <button type="button" onClick={() => save(true)} disabled={pending} className="btn-secondary py-1">Publish</button>
        <label className="flex min-w-64 flex-1 items-center gap-1 text-xs">Campus keywords
          <input value={data.collegeKeywords.join(", ")}
            onChange={(e) => setData((s) => ({ ...s, collegeKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) }))}
            className="input flex-1 py-1 text-xs" title="Comma-separated; matched against name + pickup spot" />
        </label>
        {msg && <span className="w-full text-xs" style={{ color: "var(--g-grey-600)" }}>{msg}</span>}
      </div>
      {!destination && <p className="card !p-3 text-xs text-amber-700">This day has no location coordinates, so Optimize and the route map are off — you can still build the sheet by hand.</p>}

      {/* The sheet — laid out like the Google Sheets template, horizontally scrollable. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6" style={{ background: "#fff" }}>
        <div className="w-max">
          <div className="flex items-start">
            {/* banner + grids + TOTAL (the banner spans both, like rows 1-2 of the sheet) */}
            <div>
              <input value={data.header} onChange={(e) => setData((s) => ({ ...s, header: e.target.value }))}
                className="w-full px-3 py-1.5 text-center text-[18px] font-medium text-white outline-none" style={{ background: SHEET.banner }} />
              <div className="flex items-stretch">
                <div className="min-w-[420px]">
                  {dirSection("going", "GOING ➡️")}
                  <div className="h-[22px]" />
                  {dirSection("back", "BACK ⬅️")}
                  <div className="mt-[22px] flex h-[44px] w-full items-center justify-center px-3 text-center text-[14px] font-medium text-white" style={{ background: SHEET.warn }}>
                    IF YOU SEE AN ERROR (&quot;I only have a ride there!&quot;) DM BLUM IMMEDIATELY
                  </div>
                </div>
                <div className="w-[14px] shrink-0 self-stretch" style={{ background: SHEET.sep }} />
                <TotalPanel riders={riders} drivers={drivers} grouped={grouped} selfIds={selfIds} placedNote={placedNote} onUnseatDrop={unseatDrop} />
              </div>
            </div>
            {destination && (
              <div className="ml-3 w-[480px] shrink-0">
                <div className="px-1 py-0.5 text-[11px]" style={{ color: "var(--g-grey-600)" }}>Map shows GOING routes.</div>
                <div className="h-[480px] overflow-hidden border" style={{ borderColor: "#e0e0e0" }}>
                  <RouteMap destination={destination} cars={mapCars} />
                </div>
              </div>
            )}
          </div>
          {/* bottom row, like the sheet's footer area: discrepancy tracker + fun-fact side by side */}
          <div className="mt-[22px] flex items-start gap-8">
            <DiscrepancyTracker rows={disc} riders={riders} />
            <FunFactPanel questions={funFactQuestions} answers={funFactAnswers} questionId={data.funFactQuestionId}
              onPickQuestion={(id) => setData((s) => ({ ...s, funFactQuestionId: id }))} riders={riders} />
          </div>
        </div>
      </div>
    </div>
  );
}

function placedSet(d: CarpoolDataV2["going"]): Set<string> {
  return new Set([...[...d.onCampus, ...d.offCampus].flatMap((c) => c.passengerIds), ...d.diy]);
}

function mapCarsIn(d: CarpoolDataV2["going"], f: (c: CarpoolDataV2["going"]["onCampus"][number]) => CarpoolDataV2["going"]["onCampus"][number]) {
  return { ...d, onCampus: d.onCampus.map(f), offCampus: d.offCampus.map(f) };
}
