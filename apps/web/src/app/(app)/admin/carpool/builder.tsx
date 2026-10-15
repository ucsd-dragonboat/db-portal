"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  addDriverToDirSet, carpoolToTsv, carRoutePoints, discrepancies, groupNeedsRide,
  locationKey, mirrorDirSet, movedRiders, placeInDirSet, reconcileDirSet, removeCarFromDirSet,
  removeFromDirSet, upgradeCarpoolData,
  DIRS, driversIn, formChanges, formRole, revertAll, revertChange, ridersIn, roleIn, setRole,
  type CarpoolDataV2, type CarpoolGuest, type Destination, type FormChange, type FormRides, type MatchText, type OsrmRoute, type RideRole, type Rider,
} from "@db/carpool";
import { optimizeLayout, routeCar, saveCarpool } from "./actions";
import { CarGrid, DiyRow, SHEET, type DirKey, type GridHandlers } from "./car-grid";
import { DiscrepancyTracker, FunFactPanel, NotesPanel, TotalPanel, type DiffChip } from "./side-panels";

const RouteMap = dynamic(() => import("@/components/route-map"), { ssr: false });

export type SavedCarpool = { data: unknown; published: boolean };
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

/** Sheets-style rides workspace: GOING/BACK sections of ON/OFF-CAMPUS car columns
 * + DIY, TOTAL roster with campus grouping, fun-fact column, discrepancy tracker.
 * destination === null → Optimize and the route map are disabled. */
export default function CarpoolBuilder({ eventId, carpoolId, initialName, destination, riders, drivers, needsRide, saved, pickupNames, funFactQuestions, funFactAnswers }: {
  eventId: string; carpoolId: string | null; initialName: string; destination: Destination | null; riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[]; needsRide: string[]; saved: SavedCarpool | null;
  pickupNames: Record<string, string>;
  funFactQuestions: { id: string; label: string }[];
  funFactAnswers: Record<string, { userId: string; text: string }[]>;
}) {
  // What the form responses say. Changes to it live on this layout only (data.roles).
  const form = useMemo<FormRides>(() => ({ drivers, needsRide }), [drivers, needsRide]);
  const initial = useMemo<CarpoolDataV2>(() => {
    const mt: MatchText = Object.fromEntries(Object.values(riders).map((r) => [r.id, `${r.name} ${pickupNames[r.id] ?? ""}`]));
    const up = upgradeCarpoolData(saved?.data, mt);
    // Guests (write-ins) count as riders so their placements survive reconciliation.
    const ids = new Set([...Object.keys(riders), ...up.guests.map((g) => g.id)]);
    return {
      ...up,
      // A driver switched to a passenger in this layout doesn't get their car back.
      going: reconcileDirSet(up.going, driversIn(up, "going", form), ids, mt, up.collegeKeywords, "g"),
      back: reconcileDirSet(up.back, driversIn(up, "back", form), ids, mt, up.collegeKeywords, "b"),
    };
  }, [saved, form, riders, pickupNames]);

  const [data, setData] = useState<CarpoolDataV2>(initial);
  const [name, setName] = useState(initialName);
  const router = useRouter();

  // Roster members + write-ins, one lookup for every cell/panel.
  const effRiders = useMemo<Record<string, Rider>>(() => ({
    ...riders,
    ...Object.fromEntries(data.guests.map((g) => [g.id, { id: g.id, name: g.name, location: null } as Rider])),
  }), [riders, data.guests]);
  const matchText = useMemo<MatchText>(
    () => Object.fromEntries(Object.values(effRiders).map((r) => [r.id, `${r.name} ${pickupNames[r.id] ?? ""}`])),
    [effRiders, pickupNames],
  );
  const [routes, setRoutes] = useState<Record<string, OsrmRoute | null>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const placedGoing = useMemo(() => placedSet(data.going), [data.going]);
  const placedBack = useMemo(() => placedSet(data.back), [data.back]);
  const driverIdSet = useMemo(() => new Set(drivers.map((d) => d.id)), [drivers]);
  // Who needs a ride is per direction once a layout changes someone's role.
  const disc = useMemo(() => {
    const ids = Object.keys(riders);
    const need = [...new Set([...ridersIn(data, "going", form, ids), ...ridersIn(data, "back", form, ids)])];
    return discrepancies(need, data.going, data.back)
      .map((r) => ({ ...r, needGoing: r.needGoing && roleIn(data, "going", r.id, form) !== "driver", needBack: r.needBack && roleIn(data, "back", r.id, form) !== "driver" }))
      .filter((r) => r.needGoing || r.needBack);
  }, [riders, data, form]);
  const options = useMemo(() => {
    const all = Object.values(effRiders).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
    const drivingIn = (d: CarpoolDataV2["going"]) => new Set([...d.onCampus, ...d.offCampus].map((c) => c.driverId));
    const dg = drivingIn(data.going), db = drivingIn(data.back);
    return {
      going: all.filter((o) => !placedGoing.has(o.id) && !dg.has(o.id)),
      back: all.filter((o) => !placedBack.has(o.id) && !db.has(o.id)),
      // empty Driver cells: anyone not already driving in that direction
      goingDrivers: all.filter((o) => !dg.has(o.id)),
      backDrivers: all.filter((o) => !db.has(o.id)),
    };
  }, [effRiders, placedGoing, placedBack, data.going, data.back]);

  const setDir = (dir: DirKey, f: (d: CarpoolDataV2[DirKey]) => CarpoolDataV2[DirKey]) =>
    setData((s) => ({ ...s, [dir]: f(s[dir]) }));

  const h: GridHandlers = {
    // Seating someone is also a role: a driver dropped into another car stops driving
    // there (their car goes, its passengers become unplaced) — recorded on this layout.
    place: (dir, target, riderId) => setData((s) => {
      const own = [...s[dir].onCampus, ...s[dir].offCampus].find((c) => c.driverId === riderId);
      const from = own && !(target.kind === "car" && target.carId === own.id) ? removeCarFromDirSet(s[dir], own.id) : s[dir];
      const r = placeInDirSet(from, target, riderId);
      if (r.error === "full") { setMsg("Car is full"); return s; }
      return setRole({ ...s, [dir]: r.dir }, dir, riderId, target.kind === "diy" ? "diy" : "rider", form);
    }),
    // Taking someone out of DIY undoes a DIY change (a switched driver still needs a ride).
    unseat: (dir, riderId) => setData((s) => {
      const next = { ...s, [dir]: removeFromDirSet(s[dir], riderId) };
      const fr = formRole(form, riderId);
      return roleIn(s, dir, riderId, form) === "diy" && fr !== "diy" ? setRole(next, dir, riderId, fr === "driver" ? "rider" : fr, form) : next;
    }),
    drop: (dir, target, payload) => {
      const [kind, id] = payload.split(":");
      if (kind !== "rider" || !effRiders[id]) return;
      h.place(dir, target, id);
    },
    setCap: (dir, carId, cap) => setDir(dir, (d) => mapCarsIn(d, (c) => (c.id === carId ? { ...c, capacity: Math.max(1, cap) } : c))),
    toggleLock: (dir, carId) => setDir(dir, (d) => mapCarsIn(d, (c) => (c.id === carId ? { ...c, locked: !c.locked } : c))),
    addDriver: (dir, band, riderId) => setData((s) => setRole({
      ...s, [dir]: addDriverToDirSet(s[dir], band, riderId, drivers.find((x) => x.id === riderId)?.seats ?? 5, dir === "going" ? "g" : "b"),
    }, dir, riderId, "driver", form)),
    // Removing a form driver's car switches them to needing a ride in this direction;
    // removing a car someone only drives in this layout undoes that change.
    removeCar: (dir, carId) => setData((s) => {
      const driver = [...s[dir].onCampus, ...s[dir].offCampus].find((c) => c.id === carId)?.driverId;
      const next = { ...s, [dir]: removeCarFromDirSet(s[dir], carId) };
      if (!driver) return next;
      const fr = formRole(form, driver);
      return setRole(next, dir, driver, fr === "driver" ? "rider" : fr, form);
    }),
    setComment: (dir, carId, comment) => setDir(dir, (d) => mapCarsIn(d, (c) => (c.id === carId ? { ...c, comment } : c))),
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
  const addGuest = (col: CarpoolGuest["col"], name: string) =>
    setData((s) => ({ ...s, guests: [...s.guests, { id: `x:${Math.random().toString(36).slice(2, 9)}`, name, col }] }));
  const removeGuest = (id: string) => setData((s) => ({
    ...s,
    guests: s.guests.filter((g) => g.id !== id),
    going: removeFromDirSet(s.going, id),
    back: removeFromDirSet(s.back, id),
  }));

  // Real drive times via the server's routing fallback chain — the same optimizer the
  // auto-carpool cron uses. The result replaces GOING in the (unsaved) sheet.
  const [optimizing, setOptimizing] = useState(false);
  const optimize = async (mode: "unplaced" | "moved") => {
    if (!destination) return;
    setOptimizing(true);
    setMsg(mode === "moved" ? "Re-seating moved riders…" : "Optimizing with real drive times…");
    try {
      const r = await optimizeLayout(carpoolId, eventId, data, mode);
      if ("error" in r) { setMsg(r.error); return; }
      setData((s) => ({ ...s, going: r.going, seatedAt: r.seatedAt }));
      setMsg(`${r.message} — review, then Save`);
    } catch { setMsg("Optimize failed — try again"); }
    finally { setOptimizing(false); }
  };
  // Riders in this layout whose pickup spot changed since it was built (never re-seated
  // automatically — the admin decides).
  const moved = useMemo(() => movedRiders(data, riders), [data, riders]);

  // Differences from the form responses, shown as a +/− diff in the TOTAL panel.
  const changes = useMemo(() => formChanges(data, form, new Set(Object.keys(riders))), [data, form, riders]);
  const revert = (cs: FormChange[]) => setData((s) => cs.reduce((acc, c) => revertChange(acc, c, form, matchText, s.collegeKeywords), s));
  const revertEverything = () => {
    if (!confirm(`Revert all ${changes.length} change${changes.length === 1 ? "" : "s"} to what the form responses say?`)) return;
    setData((s) => revertAll(s, form, matchText, s.collegeKeywords));
    setMsg("Reverted to the form responses — Save to keep it");
  };
  const diff = useMemo(() => {
    const ids = Object.keys(riders);
    const tag = (dirs: string[]) => (dirs.length === 2 ? "" : dirs[0] === "going" ? "G" : "B");
    const seatChanges = (id: string) => changes.filter((c) => c.kind === "seats" && c.id === id);
    const col = (role: RideRole): DiffChip[] => {
      const out: DiffChip[] = [];
      for (const id of ids) {
        const fr = formRole(form, id);
        const inDirs = DIRS.filter((d) => roleIn(data, d, id, form) === role);
        if (fr === role) {
          const gone = DIRS.filter((d) => !inDirs.includes(d));
          out.push({ id, state: gone.length ? "removed" : "same", dirs: tag(gone), partial: gone.length === 1, changes: [], seats: role === "driver" ? seatChanges(id) : [] });
        } else if (inDirs.length) {
          out.push({ id, state: "added", dirs: tag(inDirs), partial: inDirs.length === 1,
            changes: changes.filter((c) => c.kind === "role" && c.id === id && c.to === role), seats: [] });
        }
      }
      return out;
    };
    const riderChips = col("rider");
    const byId = new Map(riderChips.map((c) => [c.id, c]));
    const g = groupNeedsRide(riderChips.map((c) => c.id), matchText, data.collegeKeywords);
    return {
      drivers: col("driver"),
      grouped: { onCampus: g.onCampus.map((k) => ({ keyword: k.keyword, chips: k.ids.map((id) => byId.get(id)!) })), offCampus: g.offCampus.map((id) => byId.get(id)!) },
      diy: col("diy"),
    };
  }, [riders, form, data, changes, matchText]);

  const copyGoingToBack = () => {
    if (placedSet(data.back).size && !confirm("Overwrite the BACK section with a copy of GOING?")) return;
    setData((s) => ({ ...s, back: mirrorDirSet(s.going) }));
    setMsg("Copied Going → Back — edit Back freely, they're independent now");
  };

  // Pickup spot / driving-from for anyone not leaving from home — shown in the notes
  // panel and the copied NOTES section, never glued onto the name.
  const notes = useMemo(() => Object.fromEntries(Object.entries(pickupNames).filter(([, p]) => p)
    .map(([id, p]) => [id, driverIdSet.has(id) ? `Driving from ${p}` : `Pickup: ${p}`])), [pickupNames, driverIdSet]);

  // Tab-separated text pastes into Google Sheets as a grid (one column per car).
  const copyForSheets = async () => {
    try {
      // Same rows the fun-fact panel shows: answers from people in this layout's roster.
      const q = funFactQuestions.find((x) => x.id === data.funFactQuestionId);
      const funFact = q ? { question: q.label, rows: (funFactAnswers[q.id] ?? []).filter((r) => effRiders[r.userId]).map((r) => ({ name: effRiders[r.userId].name, text: r.text })) } : undefined;
      await navigator.clipboard.writeText(carpoolToTsv(data, (id) => effRiders[id]?.name ?? "?", notes, funFact));
      setMsg("Copied — paste into Google Sheets (one column per car: driver on top, passengers below)");
    } catch { setMsg("Couldn't copy — your browser blocked clipboard access"); }
  };

  const save = (published: boolean) => start(async () => {
    const r = await saveCarpool(carpoolId, eventId, name, data, published);
    if ("error" in r) { setMsg(r.error); return; }
    setMsg(published ? "Saved & published to members" : "Saved draft");
    // First save of a brand-new layout: open it by id (and refresh the tabs).
    if (!carpoolId) router.replace(`/admin/carpool?event=${eventId}&carpool=${r.id}`);
    else router.refresh();
  });

  // Routes for the GOING cars only — debounced, and only refetched for cars whose
  // route points actually changed (free, rate-limited servers; be gentle).
  const routeCache = useRef(new Map<string, { key: string; route: OsrmRoute | null }>());
  const goingCars = useMemo(() => [...data.going.onCampus, ...data.going.offCampus], [data.going]);
  const routeSig = useMemo(() => {
    if (!destination) return "";
    return JSON.stringify(goingCars.map((c) => [c.id, carRoutePoints(c, effRiders, destination, "pickup").map(locationKey).join("|")]));
  }, [goingCars, effRiders, destination]);
  useEffect(() => {
    if (!destination) return; // routes stays {} — destination never changes per page
    let cancelled = false;
    const t = setTimeout(async () => {
      const next: Record<string, OsrmRoute | null> = {};
      for (const c of goingCars) {
        const pts = carRoutePoints(c, effRiders, destination, "pickup");
        const key = pts.map(locationKey).join("|");
        const cached = routeCache.current.get(c.id);
        if (cached && cached.key === key) { next[c.id] = cached.route; continue; }
        if (pts.length < 2) { next[c.id] = null; routeCache.current.set(c.id, { key, route: null }); continue; }
        try {
          next[c.id] = await routeCar(pts);
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
    ? goingCars.map((c, i) => ({ id: c.id, color: COLORS[i % COLORS.length], points: carRoutePoints(c, effRiders, destination, "pickup"), route: routes[c.id] ?? null, label: effRiders[c.driverId]?.name ?? "?" }))
    : [];

  const dirSection = (dir: DirKey, label: string) => {
    const dOpts = dir === "going" ? options.goingDrivers : options.backDrivers;
    return (
      <section>
        <CarGrid dir={dir} band="onCampus" label="ON CAMPUS" directionLabel={label} cars={data[dir].onCampus} riders={effRiders} options={options[dir]} driverOptions={dOpts} h={h} />
        <CarGrid dir={dir} band="offCampus" label="OFF CAMPUS" cars={data[dir].offCampus} riders={effRiders} options={options[dir]} driverOptions={dOpts} h={h} />
        <DiyRow dir={dir} dirSet={data[dir]} riders={effRiders} options={options[dir]} h={h} />
      </section>
    );
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input w-40 py-1 text-sm font-medium" title="Layout name — members see it above this sheet" aria-label="Layout name" />
        <button type="button" onClick={() => optimize("unplaced")} disabled={!destination || optimizing} title={destination ? "Seat everyone still needing a ride in GOING, using real drive times (existing seats are kept)" : "Needs the day's location coordinates"} className="btn-primary py-1 disabled:cursor-not-allowed">{optimizing ? "Optimizing…" : "Optimize"}</button>
        <button type="button" onClick={copyGoingToBack} className="btn-secondary py-1">Copy Going → Back</button>
        <button type="button" onClick={copyForSheets} className="btn-secondary py-1" title="Copies the rides as a grid — paste into Google Sheets: one column per car, driver on top, passengers underneath">Copy for Sheets</button>
        {changes.length > 0 && (
          <button type="button" onClick={revertEverything} className="btn-secondary py-1" style={{ color: "#1a7f37" }}
            title="This layout differs from the form responses (green + / red − in the TOTAL panel). Revert all of it.">
            ↺ Revert {changes.length} change{changes.length === 1 ? "" : "s"} to form
          </button>
        )}
        <button type="button" onClick={() => save(false)} disabled={pending} className="btn-secondary py-1">Save</button>
        <button type="button" onClick={() => save(true)} disabled={pending} className="btn-secondary py-1">Publish</button>
        <label className="flex min-w-64 flex-1 items-center gap-1 text-xs">Campus keywords
          <input value={data.collegeKeywords.join(", ")}
            onChange={(e) => setData((s) => ({ ...s, collegeKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) }))}
            className="input flex-1 py-1 text-xs" title="Comma-separated; matched against name + pickup spot" />
        </label>
        {msg && <span className="w-full text-xs" style={{ color: "var(--g-grey-600)" }}>{msg}</span>}
      </div>
      {moved.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2 !p-3 text-sm" style={{ background: "var(--g-yellow-soft)" }}>
          <span><b>{moved.length}</b> rider{moved.length === 1 ? "'s" : "s'"} pickup spot changed since this layout was built: {moved.map((id) => riders[id]?.name ?? "?").join(", ")}</span>
          <button type="button" onClick={() => optimize("moved")} disabled={!destination || optimizing} className="btn-secondary py-0.5 text-xs">Re-seat {moved.length === 1 ? "them" : "just them"}</button>
          <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Everyone else stays put; locked cars aren&apos;t touched.</span>
        </div>
      )}
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
                <TotalPanel riders={effRiders} drivers={diff.drivers} driverSeats={new Map(drivers.map((d) => [d.id, d.seats]))} grouped={diff.grouped} diy={diff.diy} guests={data.guests}
                  placedNote={placedNote} onUnseatDrop={unseatDrop} onAddGuest={addGuest} onRemoveGuest={removeGuest} onRevert={revert} />
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
            <DiscrepancyTracker rows={disc} riders={effRiders} />
            <NotesPanel notes={notes} riders={effRiders} />
            <FunFactPanel questions={funFactQuestions} answers={funFactAnswers} questionId={data.funFactQuestionId}
              onPickQuestion={(id) => setData((s) => ({ ...s, funFactQuestionId: id }))} riders={effRiders} />
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
