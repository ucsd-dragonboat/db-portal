"use client";

import { useActionState, useMemo, useState } from "react";
import type { PairStat } from "@db/carpool";
import { setAttendanceAdjustment, type AdminState } from "../admin/actions";

export function AttendanceCell({ userId, value }: { userId: string; value: number }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setAttendanceAdjustment, {});
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="user_id" value={userId} />
      <input name="value" type="number" defaultValue={value} className="input w-16 py-0.5 text-xs" />
      <button disabled={pending} className="btn-text py-0.5 text-xs">{pending ? "…" : "Save"}</button>
      {state.error && <span className="text-[11px]" style={{ color: "var(--g-red)" }}>{state.error}</span>}
    </form>
  );
}

type SortKey = "a" | "b" | "timesTogether" | "minutesTogether";

function PairsTable({ pairs, names }: { pairs: PairStat[]; names: Record<string, string> }) {
  const [sortKey, setSortKey] = useState<SortKey>("timesTogether");
  const [asc, setAsc] = useState(false);
  const who = (id: string) => names[id] ?? id;
  const sorted = useMemo(() => {
    const rows = pairs.map((p) => ({ ...p, aName: who(p.a), bName: who(p.b) }));
    rows.sort((x, y) => {
      const va = sortKey === "a" ? x.aName : sortKey === "b" ? x.bName : x[sortKey];
      const vb = sortKey === "a" ? y.aName : sortKey === "b" ? y.bName : y[sortKey];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return asc ? cmp : -cmp;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, names, sortKey, asc]);
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) { setAsc(!asc); return; }
    setSortKey(key); setAsc(false);
  };
  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none" onClick={() => toggleSort(key)}>
      {label}{sortKey === key ? (asc ? " ▲" : " ▼") : ""}
    </th>
  );
  if (!sorted.length) return <p className="p-3 text-sm" style={{ color: "var(--g-grey-600)" }}>No shared rides recorded yet.</p>;
  return (
    <table className="gsheet">
      <thead><tr className="labels">{th("a", "Person A")}{th("b", "Person B")}{th("timesTogether", "Times Together")}{th("minutesTogether", "Minutes Together")}</tr></thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={`${p.a} ${p.b}`}><td>{p.aName}</td><td>{p.bName}</td><td>{p.timesTogether}</td><td>{Math.round(p.minutesTogether)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function PairsGraph({ pairs, names }: { pairs: PairStat[]; names: Record<string, string> }) {
  const [hover, setHover] = useState<string | null>(null);
  const ids = useMemo(() => Object.keys(names).sort((a, b) => names[a].localeCompare(names[b])), [names]);
  const size = 420, cx = size / 2, cy = size / 2, r = size / 2 - 50;
  const pos = useMemo(() => {
    const p: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, i) => {
      const a = (i / Math.max(ids.length, 1)) * Math.PI * 2 - Math.PI / 2;
      p[id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  const maxTimes = Math.max(1, ...pairs.map((p) => p.timesTogether));
  if (!ids.length) return null;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto" style={{ maxWidth: 480, width: "100%" }}>
      {pairs.map((p) => {
        const a = pos[p.a], b = pos[p.b];
        if (!a || !b) return null;
        const on = hover && (hover === p.a || hover === p.b);
        const dim = hover && !on;
        return (
          <line key={`${p.a} ${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={on ? "var(--g-red)" : "var(--g-blue)"} strokeWidth={1 + 3 * (p.timesTogether / maxTimes)}
            opacity={dim ? 0.08 : 0.3 + 0.5 * (p.timesTogether / maxTimes)} />
        );
      })}
      {ids.map((id) => {
        const p = pos[id];
        const dim = hover && hover !== id;
        return (
          <g key={id} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
            <circle cx={p.x} cy={p.y} r={7} fill={hover === id ? "var(--g-red)" : "var(--g-blue)"} opacity={dim ? 0.3 : 1} />
            <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={10} opacity={dim ? 0.3 : 1} fill="currentColor">{names[id]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function PairsView({ pairs, names }: { pairs: PairStat[]; names: Record<string, string> }) {
  const [mode, setMode] = useState<"table" | "graph">("table");
  return (
    <div className="sheet-wrap">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-green-soft)", color: "var(--g-green)" }}>
        <span className="font-medium">Who&apos;s ridden with whom</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setMode("table")} className={`btn-text py-0.5 text-xs ${mode === "table" ? "font-semibold" : ""}`}>Table</button>
          <button type="button" onClick={() => setMode("graph")} className={`btn-text py-0.5 text-xs ${mode === "graph" ? "font-semibold" : ""}`}>Graph</button>
        </div>
      </div>
      {mode === "table" ? <PairsTable pairs={pairs} names={names} /> : <div className="p-3"><PairsGraph pairs={pairs} names={names} /></div>}
    </div>
  );
}
