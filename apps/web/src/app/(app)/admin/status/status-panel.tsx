"use client";

import { useState } from "react";
import type { CheckMeta, CheckResult, CheckStatus } from "@/lib/status-checks";
import { runStatusCheck } from "./actions";

const PILL: Record<CheckStatus | "running", [string, string, string]> = {
  ok: ["OK", "var(--g-green-soft)", "var(--g-green)"],
  warn: ["Warn", "var(--g-yellow-soft)", "#b06000"],
  fail: ["Fail", "var(--g-red-soft)", "var(--g-red)"],
  skip: ["Skipped", "var(--g-grey-100)", "var(--g-grey-600)"],
  running: ["Running…", "var(--g-purple-soft)", "var(--g-purple)"],
};

export default function StatusPanel({ checks }: { checks: CheckMeta[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, CheckResult | "running">>({});
  const [running, setRunning] = useState(false);

  const groups = [...new Set(checks.map((c) => c.group))];
  const toggle = (ids: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const id of ids) if (on) n.add(id); else n.delete(id);
    return n;
  });

  // One at a time, in list order: keeps the free routing servers under their
  // 1-request-a-second limits, and each row fills in as soon as it's done.
  const run = async (ids: string[]) => {
    setRunning(true);
    setResults((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, "running" as const])) }));
    for (const id of ids) {
      let res: CheckResult;
      try { res = await runStatusCheck(id); } catch (e) { res = { status: "fail", detail: e instanceof Error ? e.message : "Request failed.", ms: 0 }; }
      setResults((r) => ({ ...r, [id]: res }));
    }
    setRunning(false);
  };
  const runSelected = () => run(checks.filter((c) => selected.has(c.id)).map((c) => c.id));
  const runAll = () => run(checks.filter((c) => !c.manualOnly).map((c) => c.id));

  const done = Object.values(results).filter((r): r is CheckResult => r !== "running");
  const count = (s: CheckStatus) => done.filter((r) => r.status === s).length;

  return (
    <div className="space-y-3">
      <div className="card sticky top-0 z-10 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={runSelected} disabled={running || !selected.size} className="btn-primary py-1 disabled:opacity-50">Run selected ({selected.size})</button>
        <button type="button" onClick={runAll} disabled={running} className="btn-secondary py-1 disabled:opacity-50" title="Everything except checks with side effects (the test email)">Run all</button>
        <button type="button" onClick={() => toggle(checks.map((c) => c.id), selected.size !== checks.length)} disabled={running} className="btn-text py-1">
          {selected.size === checks.length ? "Select none" : "Select all"}
        </button>
        <span className="flex-1" />
        {done.length > 0 && (
          <span className="flex flex-wrap gap-1 text-xs">
            {(["ok", "warn", "fail", "skip"] as const).map((s) => count(s) > 0 && <Pill key={s} status={s} label={`${count(s)} ${PILL[s][0].toLowerCase()}`} />)}
          </span>
        )}
      </div>

      {groups.map((g) => {
        const rows = checks.filter((c) => c.group === g);
        const allOn = rows.every((c) => selected.has(c.id));
        return (
          <section key={g} className="card space-y-1">
            <label className="flex items-center gap-2 border-b pb-2 font-medium" style={{ borderColor: "var(--g-grey-300)" }}>
              <input type="checkbox" checked={allOn} disabled={running} onChange={() => toggle(rows.map((c) => c.id), !allOn)} className="h-4 w-4 accent-[var(--g-purple)]" />
              {g} <span className="text-xs font-normal" style={{ color: "var(--g-grey-600)" }}>({rows.length})</span>
            </label>
            {rows.map((c) => {
              const r = results[c.id];
              return (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 text-sm hover:bg-[var(--g-grey-50)]">
                  <input type="checkbox" checked={selected.has(c.id)} disabled={running} onChange={(e) => toggle([c.id], e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--g-purple)]" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.label}</span>
                    {c.manualOnly && <span className="chip ml-2 !py-0 text-[10px]">sends email · not in Run all</span>}
                    <span className="block text-xs" style={{ color: "var(--g-grey-600)" }}>{c.description}</span>
                    {r && r !== "running" && <span className="mt-0.5 block break-words text-xs">{r.detail}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    {r && <Pill status={r === "running" ? "running" : r.status} />}
                    {r && r !== "running" && <span className="text-[10px]" style={{ color: "var(--g-grey-600)" }}>{r.ms} ms</span>}
                  </span>
                </label>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Pill({ status, label }: { status: CheckStatus | "running"; label?: string }) {
  const [text, bg, fg] = PILL[status];
  return <span className="chip !py-0 text-[11px] whitespace-nowrap" style={{ background: bg, color: fg, borderColor: "transparent" }}>{label ?? text}</span>;
}
