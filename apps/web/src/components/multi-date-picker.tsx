"use client";

import { useEffect, useRef, useState } from "react";

import { dayKey } from "@/lib/calendar-dates";

const key = (d: Date) => dayKey(d); // yyyy-mm-dd, local
const parse = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

/**
 * Month-grid multi-select. Click a day to toggle it; press and drag across days to paint
 * (dragging from an unselected day selects, from a selected day deselects). Touch works too.
 */
export default function MultiDatePicker({ value, onChange, allowPast = false }: { value: string[]; onChange: (dates: string[]) => void; allowPast?: boolean }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = value.length ? parse([...value].sort()[0]) : today;
  const [month, setMonth] = useState(new Date(first.getFullYear(), first.getMonth(), 1));
  const paint = useRef<{ mode: "add" | "remove"; touched: Set<string> } | null>(null);
  const latest = useRef(value); // freshest selection while painting (updated by apply + synced from props)
  useEffect(() => { latest.current = value; }, [value]);

  useEffect(() => {
    const up = () => { if (paint.current) { paint.current = null; } };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);

  const selected = new Set(value);
  const disabled = (d: Date) => !allowPast && d < today;
  const apply = (k: string, mode: "add" | "remove") => {
    const cur = latest.current; const has = cur.includes(k);
    let next = cur;
    if (mode === "add" && !has) next = [...cur, k].sort();
    if (mode === "remove" && has) next = cur.filter((x) => x !== k);
    if (next !== cur) { latest.current = next; onChange(next); }
  };
  const start = (d: Date) => {
    if (disabled(d)) return;
    const k = key(d);
    const mode: "add" | "remove" = selected.has(k) ? "remove" : "add";
    paint.current = { mode, touched: new Set([k]) };
    apply(k, mode);
  };
  const enter = (d: Date) => {
    const p = paint.current; if (!p || disabled(d)) return;
    const k = key(d); if (p.touched.has(k)) return;
    p.touched.add(k); apply(k, p.mode);
  };

  // grid: Sunday-first, 6 rows
  const y = month.getFullYear(), m = month.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(y, m, 1 - firstDow + i));
  const shiftMonth = (n: number) => setMonth(new Date(y, m + n, 1));
  const addWeekday = (dow: number) => {
    const ks = cells.filter((d) => d.getMonth() === m && d.getDay() === dow && !disabled(d)).map(key);
    const next = Array.from(new Set([...latest.current, ...ks])).sort(); latest.current = next; onChange(next);
  };

  return (
    <div className="inline-block select-none rounded-lg border bg-white p-2 text-sm" style={{ borderColor: "var(--g-grey-300)", touchAction: "none" }}>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => shiftMonth(-1)} className="btn-text px-2">‹</button>
        <div className="font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
        <button type="button" onClick={() => shiftMonth(1)} className="btn-text px-2">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]" style={{ color: "var(--g-grey-600)" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const k = key(d), on = selected.has(k), inMonth = d.getMonth() === m, off = disabled(d), isToday = k === key(today);
          return (
            <button key={k} type="button" disabled={off}
              onPointerDown={(e) => { e.preventDefault(); start(d); }} onPointerEnter={() => enter(d)}
              className="h-8 w-9 rounded text-xs transition disabled:cursor-not-allowed"
              style={{
                background: on ? "var(--g-blue)" : undefined, color: on ? "#fff" : off ? "var(--g-grey-300)" : inMonth ? "var(--g-grey-900)" : "var(--g-grey-600)",
                opacity: inMonth || on ? 1 : 0.55, outline: isToday && !on ? "1px solid var(--g-blue)" : undefined,
              }}
              title={d.toLocaleDateString()}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px]">
        <button type="button" onClick={() => addWeekday(6)} className="btn-text px-1 py-0.5">+ all Saturdays</button>
        <button type="button" onClick={() => addWeekday(0)} className="btn-text px-1 py-0.5">+ all Sundays</button>
        <span className="flex-1" />
        <span style={{ color: "var(--g-grey-600)" }}>click / drag to select</span>
      </div>
    </div>
  );
}
