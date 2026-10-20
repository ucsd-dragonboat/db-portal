"use client";

// The Members roster as a Google Sheets–style table: every header has a ▾ menu with
// Edit column type (display format), Sort, Filter, Group by and Hide; a toolbar has
// search, active-view chips, Reset and Export CSV. The view is remembered per admin in
// this browser. Logic lives in lib/sheet-view.ts; editing a row works as before.

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Icon, { type IconName } from "@/components/icon";
import ConfirmForm from "@/components/confirm-form";
import { fmtBirthday } from "@/lib/birthday";
import type { Profile } from "@/lib/database.types";
import {
  applyView, cellText, distinctValues, EMPTY_VIEW, formatValue, sanitizeView, toCsv,
  type CellValue, type Condition, type Filter, type SheetColumn, type ViewState,
} from "@/lib/sheet-view";
import { removeMember, removePending, setMemberRole } from "../actions";
import { MemberEditRow } from "./forms";

export type RosterRow = {
  kind: "member" | "pending";
  id: string; // user id, or the pending email
  full_name: string; email: string; address: string | null; lat: number | null; lon: number | null;
  city: string | null; zipcode: string | null; car_passengers: number; gender: string | null;
  weight_lb: number | null; birthday: string | null; role: string; isSelf: boolean;
  profile: Profile | null;
};

// ---------- columns ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const blank = (v: CellValue) => v === null || v === "";
/** Age today from a YYYY-MM-DD date, compared as calendar dates (no timezone shift). */
function ageOn(ymd: string, today = new Date()): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const ty = today.getFullYear(), tm = today.getMonth() + 1, td = today.getDate();
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
const decimals = (n: number) => ({ key: `d${n}`, label: `${n} decimals`, fmt: (v: CellValue) => (blank(v) ? "" : Number(v).toFixed(n)) });
const asText = { key: "text", label: "As entered", fmt: (v: CellValue) => (blank(v) ? "" : String(v)) };

export const ROSTER_COLUMNS: SheetColumn<RosterRow>[] = [
  { key: "name", label: "Name", type: "text", get: (r) => r.full_name || null },
  { key: "email", label: "Email", type: "text", get: (r) => r.email },
  { key: "address", label: "Address", type: "text", get: (r) => r.address },
  { key: "lat", label: "Latitude", type: "number", get: (r) => r.lat, formats: [asText, decimals(2), decimals(4), decimals(6)] },
  { key: "lon", label: "Longitude", type: "number", get: (r) => r.lon, formats: [asText, decimals(2), decimals(4), decimals(6)] },
  { key: "city", label: "City", type: "text", get: (r) => r.city },
  { key: "zipcode", label: "Zipcode", type: "text", get: (r) => r.zipcode },
  { key: "passengers", label: "Passengers", type: "number", get: (r) => r.car_passengers, summary: ["sum"],
    formats: [
      { key: "num", label: "Number", fmt: (v) => (blank(v) ? "" : String(v)) },
      { key: "seats", label: "Seats (“3 seats” / “No car”)", fmt: (v) => (blank(v) ? "" : Number(v) > 0 ? `${v} seat${Number(v) === 1 ? "" : "s"}` : "No car") },
    ] },
  { key: "gender", label: "Gender", type: "choice", get: (r) => r.gender, formats: [{ key: "cap", label: "Capitalized", fmt: (v) => (blank(v) ? "" : String(v)[0].toUpperCase() + String(v).slice(1)) }] },
  { key: "weight", label: "W(lb)", type: "number", get: (r) => r.weight_lb, summary: ["sum", "avg"],
    formats: [
      { key: "lb", label: "Pounds", fmt: (v) => (blank(v) ? "" : String(Math.round(Number(v) * 10) / 10)) },
      { key: "kg", label: "Kilograms", fmt: (v) => (blank(v) ? "" : `${(Number(v) * 0.45359237).toFixed(1)} kg`) },
    ] },
  { key: "birthday", label: "Birthday", type: "date", get: (r) => r.birthday,
    formats: [
      { key: "full", label: "May 17, 2003", fmt: (v) => (blank(v) ? "" : fmtBirthday(String(v))) },
      { key: "md", label: "May 17", fmt: (v) => { if (blank(v)) return ""; const [, m, d] = String(v).split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; } },
      { key: "num", label: "5/17/2003", fmt: (v) => { if (blank(v)) return ""; const [y, m, d] = String(v).split("-").map(Number); return `${m}/${d}/${y}`; } },
      { key: "age", label: "Age", fmt: (v) => (blank(v) ? "" : String(ageOn(String(v)))) },
    ] },
  { key: "role", label: "Role", type: "choice", get: (r) => (r.kind === "pending" ? "pending sign-up" : r.role) },
];

const SORT_LABELS: Record<SheetColumn<RosterRow>["type"], [string, string]> = {
  text: ["Sort A → Z", "Sort Z → A"], choice: ["Sort A → Z", "Sort Z → A"],
  number: ["Sort 1 → 9", "Sort 9 → 1"], date: ["Sort oldest → newest", "Sort newest → oldest"],
};
const CONDITIONS: Record<SheetColumn<RosterRow>["type"], { cond: Condition; label: string; inputs: 0 | 1 | 2 }[]> = {
  text: [{ cond: "contains", label: "Text contains", inputs: 1 }, { cond: "eq", label: "Text is exactly", inputs: 1 }, { cond: "empty", label: "Is empty", inputs: 0 }, { cond: "notEmpty", label: "Is not empty", inputs: 0 }],
  choice: [{ cond: "eq", label: "Is", inputs: 1 }, { cond: "contains", label: "Contains", inputs: 1 }, { cond: "empty", label: "Is empty", inputs: 0 }, { cond: "notEmpty", label: "Is not empty", inputs: 0 }],
  number: [{ cond: "gt", label: "Greater than", inputs: 1 }, { cond: "lt", label: "Less than", inputs: 1 }, { cond: "eq", label: "Is equal to", inputs: 1 }, { cond: "between", label: "Is between", inputs: 2 }, { cond: "empty", label: "Is empty", inputs: 0 }, { cond: "notEmpty", label: "Is not empty", inputs: 0 }],
  date: [{ cond: "before", label: "Date is before", inputs: 1 }, { cond: "after", label: "Date is after", inputs: 1 }, { cond: "eq", label: "Date is", inputs: 1 }, { cond: "between", label: "Date is between", inputs: 2 }, { cond: "empty", label: "Is empty", inputs: 0 }, { cond: "notEmpty", label: "Is not empty", inputs: 0 }],
};

// ---------- the remembered view (per admin, this browser) ----------
// Kept in memory too, so the table still works when storage is blocked (private mode).
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function readView(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeView(key: string, v: ViewState) {
  const s = JSON.stringify(v);
  memory.set(key, s);
  try { localStorage.setItem(key, s); } catch { /* storage full or blocked */ }
  listeners.forEach((l) => l());
}

// ---------- the table ----------
type MenuState = { key: string; x: number; y: number; panel: "menu" | "filter"; sub?: "type" | "sort" } | null;

export default function MembersSheet({ rows, orgId }: { rows: RosterRow[]; orgId: string }) {
  const storageKey = `members-view:${orgId}`;
  // The saved view, read like browse-grid's preferences: the server snapshot is "nothing
  // saved", so first paint matches the server and the saved view lands after hydration.
  const raw = useSyncExternalStore(subscribe, () => readView(storageKey), () => null);
  const view = useMemo<ViewState>(() => {
    try { return raw ? sanitizeView(JSON.parse(raw), ROSTER_COLUMNS) : EMPTY_VIEW; } catch { return EMPTY_VIEW; }
  }, [raw]);
  const setView = (v: ViewState) => writeView(storageKey, v);
  const [menu, setMenu] = useState<MenuState>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const cols = ROSTER_COLUMNS;
  const visible = cols.filter((c) => !view.hidden.includes(c.key));
  const groups = useMemo(() => applyView(rows, cols, view), [rows, cols, view]);
  const shown = groups.reduce((n, g) => n + g.count, 0);
  const update = (patch: Partial<ViewState>) => setView({ ...view, ...patch });
  const col = (key: string) => cols.find((c) => c.key === key)!;
  const withoutKey = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

  const openMenu = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu((m) => (m?.key === key && m.panel === "menu" ? null : { key, x: Math.min(r.left, window.innerWidth - 270), y: r.bottom + 4, panel: "menu" }));
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(cols, rows, view)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "members.csv" });
    a.click(); URL.revokeObjectURL(url);
  };

  const cell = (c: SheetColumn<RosterRow>, r: RosterRow) => {
    const text = cellText(c, r, view);
    if (c.key === "name") return <td key={c.key} className="font-medium whitespace-nowrap">{text || "—"}{r.isSelf && " (you)"}</td>;
    if (c.key === "address") return <td key={c.key} className="max-w-[220px]">{text || "—"}</td>;
    if (c.key === "passengers" && (view.formats.passengers ?? "num") === "num")
      return <td key={c.key}>{r.car_passengers > 0 ? <><Icon name="car" /> {r.car_passengers}</> : "0"}</td>;
    if (c.key === "role") {
      if (r.kind === "pending") return <td key={c.key}><span className="chip !py-0 text-[10px]" style={{ background: "#fef3c7", borderColor: "transparent", color: "#92400e" }}>pending sign-up</span></td>;
      if (r.isSelf) return <td key={c.key}><span style={{ color: "var(--g-grey-600)" }}>{r.role} (you)</span></td>;
      return (
        <td key={c.key}>
          <form action={setMemberRole} className="flex items-center gap-1">
            <input type="hidden" name="user_id" value={r.id} />
            <select name="role" defaultValue={r.role} className="input py-0.5 text-xs w-auto"><option value="member">member</option><option value="admin">admin</option></select>
            <button className="btn-text py-0.5 text-xs">Set</button>
          </form>
        </td>
      );
    }
    return <td key={c.key} className={c.type === "date" ? "whitespace-nowrap" : undefined}>{text || "—"}</td>;
  };

  const actions = (r: RosterRow) => (
    <td className="whitespace-nowrap">
      {r.kind === "pending"
        ? <ConfirmForm action={removePending} message={`Remove pending member ${r.email}?`}><input type="hidden" name="email" value={r.email} /><button className="btn-danger-text py-0.5 text-xs">Remove</button></ConfirmForm>
        : <>
            <button type="button" onClick={() => setEditing(r.id)} className="btn-text py-0.5 text-xs" title="Edit"><Icon name="pen" /></button>
            {!r.isSelf && <ConfirmForm action={removeMember} message={`Remove ${r.full_name || r.email} from the team?`}><input type="hidden" name="user_id" value={r.id} /><button className="btn-danger-text py-0.5 text-xs">Remove</button></ConfirmForm>}
          </>}
    </td>
  );

  const chips: { label: string; clear: () => void }[] = [
    ...(view.sort ? [{ label: `${SORT_LABELS[col(view.sort.key).type][view.sort.dir === "asc" ? 0 : 1].replace("Sort ", `Sort ${col(view.sort.key).label}: `)}`, clear: () => update({ sort: undefined }) }] : []),
    ...Object.keys(view.filters).map((k) => ({ label: `Filter: ${col(k).label}`, clear: () => update({ filters: withoutKey(view.filters, k) }) })),
    ...(view.group ? [{ label: `Grouped by ${col(view.group).label}`, clear: () => update({ group: undefined, collapsed: [] }) }] : []),
  ];
  const isDefault = JSON.stringify(view) === JSON.stringify(EMPTY_VIEW);
  let n = 0; // visible row number, across groups

  return (
    <div className="sheet-wrap">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-green-soft)", color: "var(--g-green)" }}>
        <span className="font-medium"><Icon name="table" /> Roster</span>
        <span style={{ color: "var(--g-grey-600)" }}>· {shown === rows.length ? `${rows.length} rows` : `${shown} of ${rows.length} rows`} · click <Icon name="pen" /> to edit, ▾ on a header for sort / filter / group</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 rounded border bg-white px-2 py-0.5" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>
          <Icon name="search" />
          <input value={view.search} onChange={(e) => update({ search: e.target.value })} placeholder="Search" aria-label="Search the roster" className="w-36 bg-transparent text-xs outline-none" style={{ color: "var(--g-grey-900)" }} />
          {view.search && <button type="button" onClick={() => update({ search: "" })} aria-label="Clear search"><Icon name="x" /></button>}
        </label>
        <button type="button" onClick={exportCsv} className="btn-text py-0.5 text-xs"><Icon name="download" /> Export CSV</button>
        {!isDefault && <button type="button" onClick={() => setView(EMPTY_VIEW)} className="btn-text py-0.5 text-xs"><Icon name="reset" /> Reset view</button>}
      </div>
      {(chips.length > 0 || view.hidden.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-xs" style={{ borderColor: "var(--g-grey-300)" }}>
          {chips.map((c) => (
            <span key={c.label} className="chip chip-active !py-0.5 gap-1">{c.label}<button type="button" onClick={c.clear} aria-label={`Clear ${c.label}`}><Icon name="x" /></button></span>
          ))}
          {view.hidden.length > 0 && (
            <span className="relative">
              <button type="button" onClick={() => setHiddenOpen((o) => !o)} className="chip !py-0.5 gap-1"><Icon name="eyeSlash" /> {view.hidden.length} hidden <Icon name="caret" /></button>
              {hiddenOpen && (
                <div className="sheet-menu absolute left-0 top-full z-30 mt-1" role="menu">
                  {view.hidden.map((k) => <button key={k} type="button" role="menuitem" className="sheet-menu-item" onClick={() => { update({ hidden: view.hidden.filter((x) => x !== k) }); if (view.hidden.length === 1) setHiddenOpen(false); }}><Icon name="eye" /> Show {col(k).label}</button>)}
                  <button type="button" role="menuitem" className="sheet-menu-item" onClick={() => { update({ hidden: [] }); setHiddenOpen(false); }}><Icon name="eye" /> Show all</button>
                </div>
              )}
            </span>
          )}
        </div>
      )}

      <table className="gsheet">
        <thead>
          <tr><th className="gutter" />{Array.from({ length: visible.length + 1 }, (_, i) => <th key={i} className="gutter">{String.fromCharCode(65 + i)}</th>)}</tr>
          <tr className="labels">
            <th className="gutter w-8">#</th>
            {visible.map((c) => {
              const sorted = view.sort?.key === c.key ? view.sort.dir : null;
              return (
                <th key={c.key} className="sheet-th">
                  <span className="flex items-center gap-1">
                    {c.label}
                    {view.filters[c.key] && <span title="Filtered" style={{ color: "var(--g-green)" }}><Icon name="filter" /></span>}
                    {sorted && <span title={sorted === "asc" ? "Sorted ascending" : "Sorted descending"} style={{ color: "var(--g-green)" }}><Icon name={sorted === "asc" ? "up" : "down"} /></span>}
                    <button type="button" className="sheet-th-btn" aria-label={`${c.label} column menu`} aria-haspopup="menu" aria-expanded={menu?.key === c.key}
                      onClick={(e) => openMenu(c.key, e.currentTarget)}><Icon name="caret" /></button>
                  </span>
                </th>
              );
            })}
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const collapsed = view.group ? view.collapsed.includes(g.key) : false;
            return (
              <Fragment key={`g:${g.key}`}>
              {view.group && (
                <tr className="sheet-group">
                  <td className="gutter" />
                  <td colSpan={visible.length + 1}>
                    <button type="button" onClick={() => update({ collapsed: collapsed ? view.collapsed.filter((k) => k !== g.key) : [...view.collapsed, g.key] })}
                      className="flex w-full flex-wrap items-center gap-x-3 text-left" aria-expanded={!collapsed}>
                      <span className="font-semibold"><Icon name={collapsed ? "caretRight" : "caret"} /> {col(view.group).label}: {g.label}</span>
                      <span>{g.count} {g.count === 1 ? "row" : "rows"}</span>
                      {g.stats.map((s) => {
                        const c = col(s.key);
                        return c.summary!.map((kind) => (
                          <span key={`${s.key}${kind}`} style={{ color: "var(--g-grey-600)" }}>
                            {c.label} {kind === "sum" ? "Σ" : "avg"} {formatValue(c, kind === "sum" ? Math.round(s.sum * 10) / 10 : Math.round(s.avg * 10) / 10, view)}
                          </span>
                        ));
                      })}
                    </button>
                  </td>
                </tr>
              )}
              {!collapsed && g.rows.map((r) => {
                n++;
                if (editing === r.id && r.profile) return <MemberEditRow key={r.id} index={n} profile={r.profile} role={r.role} colSpan={visible.length + 1} onClose={() => setEditing(null)} />;
                return (
                  <tr key={r.id} className={r.kind === "pending" ? "pending" : undefined} style={r.kind === "pending" ? { color: "var(--g-grey-600)" } : undefined}>
                    <td className="gutter">{n}</td>
                    {visible.map((c) => cell(c, r))}
                    {actions(r)}
                  </tr>
                );
              })}
              </Fragment>
            );
          })}
          {shown === 0 && <tr><td className="gutter" /><td colSpan={visible.length + 1} className="p-3" style={{ color: "var(--g-grey-600)" }}>{rows.length ? "No rows match this view." : "No members yet."}</td></tr>}
        </tbody>
      </table>

      {menu && menu.panel === "menu" && (
        <ColumnMenu col={col(menu.key)} view={view} at={menu} onClose={() => setMenu(null)}
          onSub={(sub) => setMenu({ ...menu, sub })}
          onFormat={(f) => { update({ formats: { ...view.formats, [menu.key]: f } }); setMenu(null); }}
          onSort={(dir) => { update({ sort: { key: menu.key, dir } }); setMenu(null); }}
          onFilter={() => setMenu({ ...menu, panel: "filter", sub: undefined })}
          onGroup={() => { update(view.group === menu.key ? { group: undefined, collapsed: [] } : { group: menu.key, collapsed: [] }); setMenu(null); }}
          onHide={() => { update({ hidden: [...view.hidden, menu.key] }); setMenu(null); }} />
      )}
      {menu && menu.panel === "filter" && (
        <FilterPanel col={col(menu.key)} at={menu}
          values={distinctValues(col(menu.key), applyView(rows, cols, { ...view, filters: withoutKey(view.filters, menu.key), group: undefined }).flatMap((g) => g.rows), view)}
          current={view.filters[menu.key]} view={view} onClose={() => setMenu(null)}
          onApply={(f) => { update({ filters: f ? { ...view.filters, [menu.key]: f } : withoutKey(view.filters, menu.key) }); setMenu(null); }} />
      )}
    </div>
  );
}

// ---------- popups ----------
/** Closes on a click outside or Escape; arrow keys move between items. */
function usePopup(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.(".sheet-th-btn")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // The page scrolling or resizing would leave a fixed popup behind; its own list scrolling is fine.
    const away = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    window.addEventListener("resize", away); window.addEventListener("scroll", away, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", away); window.removeEventListener("scroll", away, true); };
  }, [onClose]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled]), input, select")?.focus(); }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  return { ref, onKeyDown };
}

function Item({ icon, label, onClick, sub, checked, disabled, onHover }: { icon?: IconName; label: string; onClick: () => void; sub?: boolean; checked?: boolean; disabled?: boolean; onHover?: () => void }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} onMouseEnter={onHover} className="sheet-menu-item" aria-haspopup={sub ? "menu" : undefined}>
      <span className="w-5 text-center">{checked !== undefined ? (checked ? <Icon name="check" /> : null) : icon ? <Icon name={icon} /> : null}</span>
      <span className="flex-1">{label}</span>
      {sub && <Icon name="caretRight" />}
    </button>
  );
}

function ColumnMenu({ col, view, at, onClose, onSub, onFormat, onSort, onFilter, onGroup, onHide }: {
  col: SheetColumn<RosterRow>; view: ViewState; at: NonNullable<MenuState>; onClose: () => void; onSub: (s?: "type" | "sort") => void;
  onFormat: (f: string) => void; onSort: (d: "asc" | "desc") => void; onFilter: () => void; onGroup: () => void; onHide: () => void;
}) {
  const { ref, onKeyDown } = usePopup(onClose);
  const fmt = view.formats[col.key] ?? col.formats?.[0]?.key;
  const [asc, desc] = SORT_LABELS[col.type];
  return (
    <div ref={ref} onKeyDown={onKeyDown} role="menu" aria-label={`${col.label} column`} className="sheet-menu fixed z-40" style={{ left: at.x, top: at.y }}>
      <Item icon="textType" label="Edit column type" sub disabled={!col.formats || col.formats.length < 2} onClick={() => onSub(at.sub === "type" ? undefined : "type")} onHover={() => onSub("type")} />
      {at.sub === "type" && col.formats && (
        <div className="sheet-submenu" role="menu" aria-label="Column type">
          {col.formats.map((f) => <Item key={f.key} label={f.label} checked={f.key === fmt} onClick={() => onFormat(f.key)} />)}
        </div>
      )}
      <Item icon="sortAz" label="Sort column" sub onClick={() => onSub(at.sub === "sort" ? undefined : "sort")} onHover={() => onSub("sort")} />
      {at.sub === "sort" && (
        <div className="sheet-submenu" role="menu" aria-label="Sort">
          <Item icon="sortAz" label={asc} onClick={() => onSort("asc")} />
          <Item icon="sortZa" label={desc} onClick={() => onSort("desc")} />
        </div>
      )}
      <Item icon="filter" label={view.filters[col.key] ? "Edit filter" : "Filter column"} onClick={onFilter} onHover={() => onSub(undefined)} />
      <Item icon="group" label={view.group === col.key ? "Ungroup" : "Group by column"} onClick={onGroup} onHover={() => onSub(undefined)} />
      <Item icon="eyeSlash" label="Hide column" onClick={onHide} onHover={() => onSub(undefined)} />
    </div>
  );
}

function FilterPanel({ col, at, values, current, view, onClose, onApply }: {
  col: SheetColumn<RosterRow>; at: NonNullable<MenuState>; values: (string | null)[]; current?: Filter; view: ViewState;
  onClose: () => void; onApply: (f: Filter | null) => void;
}) {
  const { ref, onKeyDown } = usePopup(onClose);
  const conds = CONDITIONS[col.type];
  const [mode, setMode] = useState<"values" | "cond">(current && "cond" in current ? "cond" : "values");
  const [checked, setChecked] = useState<Set<string | null>>(new Set(current && "values" in current ? current.values : values));
  const [q, setQ] = useState("");
  const [cond, setCond] = useState<Condition>(current && "cond" in current ? current.cond : conds[0].cond);
  const [a, setA] = useState(current && "cond" in current ? current.a ?? "" : "");
  const [b, setB] = useState(current && "cond" in current ? current.b ?? "" : "");
  const inputs = conds.find((c) => c.cond === cond)?.inputs ?? 0;
  const inputType = col.type === "number" ? "number" : col.type === "date" ? "date" : "text";
  const shownValues = values.filter((v) => !q || (v ?? "(Blanks)").toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string | null) => setChecked((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const apply = () => {
    if (mode === "values") onApply(values.every((v) => checked.has(v)) ? null : { values: [...checked] }); // everything checked = no filter
    else onApply({ cond, ...(inputs >= 1 ? { a } : {}), ...(inputs === 2 ? { b } : {}) });
  };
  return (
    <div ref={ref} onKeyDown={onKeyDown} role="dialog" aria-label={`Filter ${col.label}`} className="sheet-menu fixed z-40 w-64 space-y-2 p-3 text-xs" style={{ left: at.x, top: at.y }}>
      <div className="font-medium text-sm">Filter: {col.label}</div>
      <div className="flex gap-1">
        <button type="button" onClick={() => setMode("values")} className={`chip !py-0.5 ${mode === "values" ? "chip-active" : ""}`}>By values</button>
        <button type="button" onClick={() => setMode("cond")} className={`chip !py-0.5 ${mode === "cond" ? "chip-active" : ""}`}>By condition</button>
      </div>
      {mode === "values" ? (
        <>
          <div className="flex gap-3">
            <button type="button" className="underline" style={{ color: "var(--g-blue)" }} onClick={() => setChecked(new Set(values))}>Select all</button>
            <button type="button" className="underline" style={{ color: "var(--g-blue)" }} onClick={() => setChecked(new Set())}>Clear</button>
            <span className="flex-1 text-right" style={{ color: "var(--g-grey-600)" }}>{checked.size} of {values.length}</span>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values" className="input py-1 text-xs" />
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {shownValues.map((v) => (
              <label key={v ?? "\u0000"} className="flex items-center gap-2"><input type="checkbox" checked={checked.has(v)} onChange={() => toggle(v)} /> {v ?? <i>(Blanks)</i>}</label>
            ))}
            {!shownValues.length && <p style={{ color: "var(--g-grey-600)" }}>No values.</p>}
          </div>
        </>
      ) : (
        <>
          <select value={cond} onChange={(e) => setCond(e.target.value as Condition)} className="input py-1 text-xs" aria-label="Condition">
            {conds.map((c) => <option key={c.cond} value={c.cond}>{c.label}</option>)}
          </select>
          {inputs >= 1 && <input value={a} onChange={(e) => setA(e.target.value)} type={inputType} step="any" placeholder="Value" className="input py-1 text-xs" aria-label="Value" />}
          {inputs === 2 && <input value={b} onChange={(e) => setB(e.target.value)} type={inputType} step="any" placeholder="and" className="input py-1 text-xs" aria-label="Second value" />}
          {col.type === "number" && view.formats[col.key] === "kg" && <p style={{ color: "var(--g-grey-600)" }}>Numbers are compared in pounds (the stored value).</p>}
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {current && <button type="button" onClick={() => onApply(null)} className="btn-text py-0.5 text-xs">Remove filter</button>}
        <button type="button" onClick={onClose} className="btn-text py-0.5 text-xs">Cancel</button>
        <button type="button" onClick={apply} className="btn-primary py-0.5 text-xs">OK</button>
      </div>
    </div>
  );
}
