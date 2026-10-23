"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  addDriverToDirSet, buildRidesSheet, carRoutePoints, discrepancies, groupNeedsRide,
  locationKey, mirrorDirSet, movedRiders, placeInDirSet, reconcileDirSet, removeCarFromDirSet,
  removeFromDirSet, upgradeCarpoolData,
  DIRS, driversIn, matchKeyword, moveCar, spotOf, swapDriver, formChanges, formRole, revertAll, revertChange, ridersIn, roleIn, setRole,
  type CarpoolDataV2, type CarpoolGuest, type Destination, type FormChange, type FormRides, type MatchText, type OsrmRoute, type RideRole, type Rider,
  DEFAULT_SHEET_COLORS, sheetColors, textOn, type SheetColorKey,
} from "@db/carpool";
import { optimizeLayout, routeCar, saveCarpool } from "./actions";
import { ColorPicker, SheetColorsProvider, colorBar } from "./sheet-colors";
import { CarGrid, DiyRow, parseDrag, type DirKey, type GridHandlers } from "./car-grid";
import { DiscrepancyTracker, FunFactPanel, NotesPanel, TotalPanel, type DiffChip } from "./side-panels";

const RouteMap = dynamic(() => import("@/components/route-map"), { ssr: false });

export type SavedCarpool = { data: unknown; published: boolean };
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

/** Sheets-style rides workspace: GOING/BACK sections of ON/OFF-CAMPUS car columns
 * + DIY, TOTAL roster with campus grouping, fun-fact column, discrepancy tracker.
 * destination === null → Optimize and the route map are disabled. */
export default function CarpoolBuilder({ eventId, carpoolId, initialName, destination, riders, drivers, needsRide, saved, pickupNames, campusSpots, funFactQuestions, funFactAnswers }: {
  eventId: string; carpoolId: string | null; initialName: string; destination: Destination | null; riders: Record<string, Rider>;
  drivers: { id: string; seats: number }[]; needsRide: string[]; saved: SavedCarpool | null;
  pickupNames: Record<string, string>;
  /** Riders whose answer was an on-campus spot → its name (on campus whatever the keywords say). */
  campusSpots: Record<string, string>;
  funFactQuestions: { id: string; label: string }[];
  funFactAnswers: Record<string, { userId: string; name: string; text: string }[]>;
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
  // Whether members can see this layout — Copy for Sheets saves without changing it.
  const [published, setPublished] = useState(saved?.published ?? false);
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
  // The layout's colours (Master Sheet defaults + its overrides) and the open colour picker.
  const colors = useMemo(() => sheetColors(data.colors), [data.colors]);
  const [colorPick, setColorPick] = useState<{ key: SheetColorKey; x: number; y: number } | null>(null);
  const pickColor = (key: SheetColorKey, e: React.MouseEvent) => setColorPick({ key, x: e.clientX, y: e.clientY });
  const colorCtx = { c: colors, pick: pickColor };
  // The keywords box text as typed (so commas and spaces survive); null = show the list
  // in use. Enter, Apply or leaving the box puts it into use, regrouping the TOTAL
  // panel's people. Cars stay in whichever grid they're in.
  const [keywordDraft, setKeywordDraft] = useState<string | null>(null);
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
      const { kind, id } = parseDrag(payload);
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
    moveCar: (dir, carId, band, beforeCarId) => setDir(dir, (d) => moveCar(d, carId, band, beforeCarId)),
    // The dropped person drives this car; its old driver takes their old spot (and role).
    swapDriver: (dir, carId, riderId) => setData((s) => {
      if (!effRiders[riderId]) return s;
      const r = swapDriver(s[dir], carId, riderId, dir === "going" ? "g" : "b");
      if (!r) return s;
      const oldRole: RideRole = r.oldDriverSpot === "driver" ? "driver" : r.oldDriverSpot === "diy" ? "diy" : "rider";
      return setRole(setRole({ ...s, [dir]: r.dir }, dir, riderId, "driver", form), dir, r.oldDriverId, oldRole, form);
    }),
  };
  const unseatDrop = (payload: string) => {
    const { kind, id, origin } = parseDrag(payload);
    if (kind !== "rider" || (origin !== "going" && origin !== "back")) return;
    h.unseat(origin as DirKey, id);
  };
  // Dropping someone on a people-list column switches how they ride, in BOTH directions:
  // DRIVERS gives them a car, NEED RIDE takes their car away, DIY puts them in the DIY row.
  // A passenger dropped on the column they already belong to is just unseated, as before.
  const roleDrop = (col: CarpoolGuest["col"], payload: string) => {
    const { kind, id, origin } = parseDrag(payload);
    if (kind !== "rider" || !effRiders[id]) return;
    if (id.startsWith("x:")) { // a write-in just moves to that column
      setData((s) => ({ ...s, guests: s.guests.map((g) => (g.id === id ? { ...g, col } : g)) }));
      return;
    }
    const role: RideRole = col === "drivers" ? "driver" : col === "diy" ? "diy" : "rider";
    if ((origin === "going" || origin === "back") && roleIn(data, origin, id, form) === role) { h.unseat(origin, id); return; }
    setData((s) => DIRS.reduce((acc, dir) => {
      const prefix = dir === "going" ? "g" : "b";
      const spot = spotOf(acc[dir], id);
      let d = acc[dir];
      if (role === "driver") {
        if (spot.kind !== "driver") {
          const band = matchKeyword(matchText[id] ?? "", acc.collegeKeywords) ? "onCampus" : "offCampus";
          d = addDriverToDirSet(d, band, id, drivers.find((x) => x.id === id)?.seats ?? 5, prefix);
        }
      } else {
        if (spot.kind === "driver") d = removeCarFromDirSet(d, spot.carId); // its passengers become unplaced
        if (role === "rider") d = { ...d, diy: d.diy.filter((p) => p !== id) };
        else if (spot.kind !== "diy") d = { ...removeFromDirSet(d, id), diy: [...removeFromDirSet(d, id).diy, id] };
      }
      return setRole({ ...acc, [dir]: d }, dir, id, role, form);
    }, s));
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
  /** Enter / Apply / leaving the box: use the typed campus keywords. */
  const applyKeywords = () => {
    if (keywordDraft === null) return;
    setData((s) => ({ ...s, collegeKeywords: keywordDraft.split(",").map((k) => k.trim()).filter(Boolean) }));
    setKeywordDraft(null);
  };
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
    const g = groupNeedsRide(riderChips.map((c) => c.id), matchText, data.collegeKeywords, campusSpots);
    return {
      drivers: col("driver"),
      grouped: { onCampus: g.onCampus.map((k) => ({ keyword: k.keyword, chips: k.ids.map((id) => byId.get(id)!) })), offCampus: g.offCampus.map((id) => byId.get(id)!) },
      diy: col("diy"),
    };
  }, [riders, form, data, changes, matchText, campusSpots]);

  const copyGoingToBack = () => {
    if (placedSet(data.back).size && !confirm("Overwrite the BACK section with a copy of GOING?")) return;
    // BACK takes GOING's role changes too, so the TOTAL panel's change markers match the copied cars.
    setData((s) => {
      const roles = { ...s.roles };
      if (roles.going) roles.back = { ...roles.going }; else delete roles.back;
      return { ...s, back: mirrorDirSet(s.going), roles: Object.keys(roles).length ? roles : undefined };
    });
    setMsg("Copied Going → Back — edit Back freely, they're independent now");
  };

  // Pickup spot / driving-from for anyone not leaving from home — shown in the notes
  // panel, never glued onto the name.
  const notes = useMemo(() => Object.fromEntries(Object.entries(pickupNames).filter(([, p]) => p)
    .map(([id, p]) => [id, driverIdSet.has(id) ? `Driving from ${p}` : `Pickup: ${p}`])), [pickupNames, driverIdSet]);

  // The TOTAL panel's NEED RIDE · OFF CAMPUS people (write-ins there too): light blue
  // when seated in an ON CAMPUS car, on screen and in the copied sheet.
  const offCampusIds = useMemo(() => new Set([
    ...diff.grouped.offCampus.filter((c) => !(c.state === "removed" && !c.partial)).map((c) => c.id),
    ...data.guests.filter((g) => g.col === "offCampus").map((g) => g.id),
  ]), [diff, data.guests]);

  // Copies the Master Sheet ride tab's layout as an HTML table — Google Sheets keeps its
  // colours and merged cells — with the same grid as plain text for other apps.
  const copyForSheets = async () => {
    try {
      // Same rows the fun-fact panel shows: answers from people in this layout's roster.
      const q = funFactQuestions.find((x) => x.id === data.funFactQuestionId);
      const funFact = q ? { question: q.label, rows: (funFactAnswers[q.id] ?? []).map((r) => ({ name: r.name, text: r.text })) } : undefined;
      // The TOTAL panel as shown: names, without people moved out of a column in both directions.
      const nameOf = (id: string) => effRiders[id]?.name ?? "?";
      const live = (cs: { id: string; state: string; partial: boolean }[]) => cs.filter((c) => !(c.state === "removed" && !c.partial)).map((c) => nameOf(c.id));
      const guestNames = (col: CarpoolGuest["col"]) => data.guests.filter((g) => g.col === col).map((g) => g.name);
      const people = {
        drivers: [...live(diff.drivers), ...guestNames("drivers")],
        offCampus: [...live(diff.grouped.offCampus), ...guestNames("offCampus")],
        onCampus: [
          ...diff.grouped.onCampus.map((g) => ({ keyword: g.keyword, names: live(g.chips) })).filter((g) => g.names.length),
          ...(guestNames("onCampus").length ? [{ keyword: "", names: guestNames("onCampus") }] : []), // write-ins: no heading, like on screen
        ],
        diy: [...live(diff.diy), ...guestNames("diy")],
      };
      const { html, tsv, tracker } = buildRidesSheet(data, { nameOf, people, funFact, highlight: offCampusIds });
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tsv], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      const copied = `Copied — click cell A1 of a blank tab in Google Sheets and paste (colours, merges and formulas come with it)${tracker === "A67" ? "" : ` · this layout is bigger than the template, so the discrepancy tracker is at ${tracker} instead of A67`}`
        + (funFact ? "" : funFactQuestions.length ? " · no fun-fact question picked, so Q/R are empty — pick one in the yellow panel and copy again" : "");
      // Copying also saves (keeping the layout's published state), so what was pasted —
      // including the picked question — is what's stored.
      save(published, copied);
    } catch { setMsg("Couldn't copy — your browser blocked clipboard access"); }
  };

  /** Save the layout; `published` true publishes it. `doneMsg` replaces the usual message. */
  const save = (publish: boolean, doneMsg?: string) => start(async () => {
    const r = await saveCarpool(carpoolId, eventId, name, data, publish);
    if ("error" in r) { setMsg(doneMsg ? `${doneMsg} — but saving failed: ${r.error}` : r.error); return; }
    setPublished(publish);
    setMsg(doneMsg ? `${doneMsg} · saved` : publish ? "Saved & published to members" : "Saved draft");
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
        <CarGrid dir={dir} band="onCampus" label="ON CAMPUS" directionLabel={label} cars={data[dir].onCampus} riders={effRiders} options={options[dir]} driverOptions={dOpts} h={h} highlight={offCampusIds} />
        <CarGrid dir={dir} band="offCampus" label="OFF CAMPUS" cars={data[dir].offCampus} riders={effRiders} options={options[dir]} driverOptions={dOpts} h={h} />
        <DiyRow dir={dir} dirSet={data[dir]} riders={effRiders} options={options[dir]} h={h} />
      </section>
    );
  };

  return (
    <SheetColorsProvider value={colorCtx}>
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input w-40 py-1 text-sm font-medium" title="Layout name — members see it above this sheet" aria-label="Layout name" />
        <button type="button" onClick={() => optimize("unplaced")} disabled={!destination || optimizing} title={destination ? "Seat everyone still needing a ride in GOING, using real drive times (existing seats are kept)" : "Needs the day's location coordinates"} className="btn-primary py-1 disabled:cursor-not-allowed">{optimizing ? "Optimizing…" : "Optimize"}</button>
        <button type="button" onClick={copyGoingToBack} className="btn-secondary py-1">Copy Going → Back</button>
        <button type="button" onClick={copyForSheets} className="btn-secondary py-1" title="Copies the rides laid out like the Master Sheet ride tab — car grids, TOTAL people grid, then the question — with its colours. Paste into cell A1 of a blank Google Sheets tab.">Copy for Sheets</button>
        {changes.length > 0 && (
          <button type="button" onClick={revertEverything} className="btn-secondary py-1" style={{ color: "#1a7f37" }}
            title="This layout differs from the form responses (green + / red − in the TOTAL panel). Revert all of it.">
            ↺ Revert {changes.length} change{changes.length === 1 ? "" : "s"} to form
          </button>
        )}
        <button type="button" onClick={() => save(false)} disabled={pending} className="btn-secondary py-1">Save</button>
        <button type="button" onClick={() => save(true)} disabled={pending} className="btn-secondary py-1">Publish</button>
        <form onSubmit={(e) => { e.preventDefault(); applyKeywords(); }} className="flex min-w-64 flex-1 items-center gap-1 text-xs">
          <label className="flex flex-1 items-center gap-1">Campus keywords
            <input value={keywordDraft ?? data.collegeKeywords.join(", ")}
              onChange={(e) => setKeywordDraft(e.target.value)} onBlur={applyKeywords}
              className="input flex-1 py-1 text-xs" title="Comma-separated; matched against name + pickup spot. Enter or Apply regroups the people in the TOTAL panel." />
          </label>
          <button type="submit" disabled={keywordDraft === null} className="btn-secondary py-1 text-xs disabled:opacity-50" title="Regroup the people needing a ride by these keywords (cars stay where they are)">Apply</button>
        </form>
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

      {/* The sheet — laid out like the Google Sheets template, horizontally scrollable.
          Clicking a coloured bar opens the colour picker; colours are saved with the layout. */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--g-grey-600)" }}>
        <span>Click any coloured bar to change its colour.</span>
        <button type="button" onClick={(e) => pickColor("highlight", e)} className="flex items-center gap-1 underline">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colors.highlight, border: "1px solid #0000002a" }} /> Off-campus rider in an on-campus car
        </button>
        <button type="button" onClick={(e) => pickColor("teal", e)} className="flex items-center gap-1 underline">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colors.teal, border: "1px solid #0000002a" }} /> Teal bar (Copy for Sheets)
        </button>
        {data.colors && <button type="button" onClick={() => setData((s) => ({ ...s, colors: undefined }))} className="underline">Reset all colours</button>}
      </div>
      {colorPick && (
        <ColorPicker key={colorPick.key} colorKey={colorPick.key} value={colors[colorPick.key]} x={colorPick.x} y={colorPick.y}
          onClose={() => setColorPick(null)}
          onPick={(hex) => {
            setData((s) => {
              const next = { ...s.colors };
              if (hex && hex !== DEFAULT_SHEET_COLORS[colorPick.key]) next[colorPick.key] = hex; else delete next[colorPick.key];
              return { ...s, colors: Object.keys(next).length ? next : undefined };
            });
            setColorPick(null);
          }} />
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6" style={{ background: "#fff" }}>
        <div className="w-max">
          <div className="flex items-start">
            {/* banner + grids + TOTAL (the banner spans both, like rows 1-2 of the sheet) */}
            <div>
              <div className="relative">
                <input value={data.header} onChange={(e) => setData((s) => ({ ...s, header: e.target.value }))}
                  className="w-full px-3 py-1.5 text-center text-[18px] font-medium outline-none" style={{ background: colors.banner, color: textOn(colors.banner) }} />
                <button type="button" onClick={(e) => pickColor("banner", e)} title="Banner colour" aria-label="Banner colour"
                  className="absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full" style={{ background: colors.banner, border: `2px solid ${textOn(colors.banner)}` }} />
              </div>
              <div className="flex items-stretch">
                <div className="min-w-[420px]">
                  {dirSection("going", "GOING ➡️")}
                  <div className="h-[22px]" />
                  {dirSection("back", "BACK ⬅️")}
                  <div {...colorBar(colorCtx, "notice")} className="mt-[22px] flex h-[44px] w-full items-center justify-center px-3 text-center text-[14px] font-medium">
                    IF YOU SEE AN ERROR (&quot;I only have a ride there!&quot;) DM BLUM IMMEDIATELY
                  </div>
                </div>
                <div {...colorBar(colorCtx, "sep")} className="w-[14px] shrink-0 self-stretch" />
                <TotalPanel riders={effRiders} drivers={diff.drivers} driverSeats={new Map(drivers.map((d) => [d.id, d.seats]))} grouped={diff.grouped} diy={diff.diy} guests={data.guests}
                  placedNote={placedNote} onUnseatDrop={unseatDrop} onRoleDrop={roleDrop} onAddGuest={addGuest} onRemoveGuest={removeGuest} onRevert={revert} />
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
              onPickQuestion={(id) => setData((s) => ({ ...s, funFactQuestionId: id }))} />
          </div>
        </div>
      </div>
    </div>
    </SheetColorsProvider>
  );
}

function placedSet(d: CarpoolDataV2["going"]): Set<string> {
  return new Set([...[...d.onCampus, ...d.offCampus].flatMap((c) => c.passengerIds), ...d.diy]);
}

function mapCarsIn(d: CarpoolDataV2["going"], f: (c: CarpoolDataV2["going"]["onCampus"][number]) => CarpoolDataV2["going"]["onCampus"][number]) {
  return { ...d, onCampus: d.onCampus.map(f), offCampus: d.offCampus.map(f) };
}
