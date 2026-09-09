"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEventsBatch } from "@/app/(app)/admin/actions";
import { combineLocal, dayLabel, formatTime, parseTimeText, shortDate } from "@/lib/time";
import RichEditor from "@/components/rich-editor";
import MultiDatePicker from "@/components/multi-date-picker";
import { createClient } from "@/lib/supabase/client";
import type { SavedLocation } from "@/lib/database.types";

type Kind = "practice" | "race" | "social" | "other";
const KIND_LABEL: Record<Kind, string> = { practice: "Practice", race: "Race", social: "Social", other: "Event" };

/**
 * "Add days" widget: pick dates, type start/end times, one event is created per date.
 * Used standalone on Admin → Events and inline in the form editor (onCreated links them to the form).
 */
export default function EventBatchForm({ onCreated, compact = false, groupId = null, folderId = null, initialDates = [] }: { onCreated?: (ids: string[], groupId: string | null) => void; compact?: boolean; groupId?: string | null; folderId?: string | null; initialDates?: string[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("practice");
  const [title, setTitle] = useState("");
  const [dates, setDates] = useState<string[]>(initialDates);
  const [start, setStart] = useState("8:45am");
  const [end, setEnd] = useState("");
  const [deadline, setDeadline] = useState({ date: "", time: "11:59pm" });
  // Per-day time overrides; blank fields inherit the shared Start/End above.
  const [overrides, setOverrides] = useState<Record<string, { start: string; end: string }>>({});
  const [loc, setLoc] = useState({ name: "", lat: "", lon: "" });
  const [saved, setSaved] = useState<SavedLocation[]>([]);
  const [notes, setNotes] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();

  // Saved locations (Team settings) offered as suggestions.
  useEffect(() => {
    createClient().from("saved_locations").select("*").order("sort_order").order("name")
      .then(({ data }) => setSaved(data ?? []));
  }, []);
  const pickSaved = (id: string) => {
    const l = saved.find((x) => x.id === id);
    if (l) setLoc({ name: l.name, lat: l.lat != null ? String(l.lat) : "", lon: l.lon != null ? String(l.lon) : "" });
  };

  const startT = parseTimeText(start), endT = end ? parseTimeText(end) : null;
  const setOv = (d: string, field: "start" | "end", v: string) =>
    setOverrides((o) => ({ ...o, [d]: { ...(o[d] ?? { start: "", end: "" }), [field]: v } }));
  /** Effective times for a day: its override when filled, else the shared defaults. */
  const timesFor = (d: string) => {
    const ov = overrides[d];
    const sRaw = ov?.start.trim() ? ov.start : start;
    const eRaw = ov?.end.trim() ? ov.end : end;
    return { sRaw, eRaw, sT: parseTimeText(sRaw), eT: eRaw ? parseTimeText(eRaw) : null };
  };
  const addNextWeekend = () => {
    const out = [...dates]; const t = new Date();
    for (let i = 1; i <= 7; i++) { const d = new Date(t); d.setDate(t.getDate() + i); if (d.getDay() === 6 || d.getDay() === 0) { const s = d.toLocaleDateString("sv"); if (!out.includes(s)) out.push(s); } }
    setDates(out.sort());
  };
  const defaultGroupName = () => {
    if (!dates.length) return KIND_LABEL[kind];
    const a = shortDate(dates[0]), b = shortDate(dates[dates.length - 1]);
    return dates.length > 1 ? `${KIND_LABEL[kind]} · ${a} – ${b}` : `${KIND_LABEL[kind]} · ${a}`;
  };
  // Day name convention: "Saturday 8/22" (+ optional suffix, e.g. "Saturday 8/22 · Time trials").
  const titleFor = (d: string) => `${dayLabel(d)}${title.trim() ? ` · ${title.trim()}` : ""}`;

  const submit = () => {
    setError(null);
    if (!dates.length) return setError("Pick at least one date.");
    if (!startT) return setError("Start time looks off — try “8:45am”.");
    if (end && !endT) return setError("End time looks off — try “11am”.");
    const dl = deadline.date ? combineLocal(deadline.date, deadline.time || "11:59pm") : null;
    const items: { title: string; starts_at: string; ends_at: string | null; rsvp_deadline: string | null }[] = [];
    for (const d of dates) {
      const { sRaw, eRaw, sT, eT } = timesFor(d);
      if (!sT) return setError(`Start time for ${shortDate(d)} looks off — try “8:45am”.`);
      if (eRaw && !eT) return setError(`End time for ${shortDate(d)} looks off — try “11am”.`);
      items.push({ title: titleFor(d), starts_at: combineLocal(d, sRaw)!, ends_at: eRaw ? combineLocal(d, eRaw) : null, rsvp_deadline: dl });
    }
    run(async () => {
      const r = await createEventsBatch({ kind, items, location_name: loc.name.trim() || null, location_lat: loc.lat ? Number(loc.lat) : null, location_lon: loc.lon ? Number(loc.lon) : null, notes: notes.trim() || null,
        groupId, groupName: groupId ? null : (groupName.trim() || defaultGroupName()), folderId });
      if (r.error) { setError(r.error); return; }
      onCreated?.(r.ids ?? [], r.groupId ?? null);
      setDates([]); setNotes("");
      router.refresh();
    });
  };

  return (
    <div className={`space-y-3 text-sm ${compact ? "" : "card"}`}>
      {!groupId && (
        <div className="grid grid-cols-[130px_1fr] gap-3">
          <div><label className="label">Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="input"><option value="practice">Practice</option><option value="race">Race</option><option value="social">Social</option><option value="other">Other</option></select></div>
          <div><label className="label">Event name</label>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={defaultGroupName()} className="input" />
            <div className="text-xs mt-0.5" style={{ color: "var(--g-grey-600)" }}>e.g. “Spring Week 8 Practice”, “Long Beach Race”. Days are added inside it below.</div></div>
        </div>
      )}

      <div>
        <label className="label">Days — one day card per date (click to select, drag to select many, click again to deselect)</label>
        <div className="flex flex-wrap items-start gap-3">
          <MultiDatePicker value={dates} onChange={setDates} />
          <div className="flex flex-col gap-1">
            <button type="button" onClick={addNextWeekend} className="btn-text text-left">+ next Sat & Sun</button>
            {dates.length > 0 && <button type="button" onClick={() => setDates([])} className="btn-text text-left">Clear all</button>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <span key={d} className="chip chip-active gap-1.5">{shortDate(d)}<button type="button" onClick={() => setDates(dates.filter((x) => x !== d))} aria-label="remove">✕</button></span>
          ))}
          {!dates.length && <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>No dates yet.</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Start time</label>
          <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="8:45am" className="input" />
          <div className="text-xs mt-0.5" style={{ color: startT ? "var(--g-grey-600)" : "var(--g-red)" }}>{startT ? `= ${formatTime(startT.h, startT.m)}` : "e.g. 8:45am, 845, 20:00"}</div></div>
        <div><label className="label">End time (optional)</label>
          <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="11am" className="input" />
          <div className="text-xs mt-0.5" style={{ color: !end || endT ? "var(--g-grey-600)" : "var(--g-red)" }}>{endT ? `= ${formatTime(endT.h, endT.m)}` : end ? "can't read that" : " "}</div></div>
      </div>

      {dates.length > 0 && (
        <details className="rounded border p-3" style={{ borderColor: "var(--g-grey-300)" }} open={Object.values(overrides).some((o) => o.start.trim() || o.end.trim())}>
          <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--g-grey-600)" }}>Different times on some days? (optional)</summary>
          <div className="mt-2 space-y-1.5">
            {dates.map((d) => {
              const ov = overrides[d] ?? { start: "", end: "" };
              const { sT, eT, eRaw } = timesFor(d);
              return (
                <div key={d} className="grid grid-cols-[1fr_110px_110px] items-center gap-2">
                  <span className="text-xs">{dayLabel(d)}</span>
                  <input value={ov.start} onChange={(e) => setOv(d, "start", e.target.value)} placeholder={start || "start"} className="input py-1" aria-label={`Start time for ${shortDate(d)}`} />
                  <input value={ov.end} onChange={(e) => setOv(d, "end", e.target.value)} placeholder={end || "(no end)"} className="input py-1" aria-label={`End time for ${shortDate(d)}`} />
                  <span className="col-span-3 -mt-1 text-[11px]" style={{ color: sT && (!eRaw || eT) ? "var(--g-grey-600)" : "var(--g-red)" }}>
                    {sT ? `= ${formatTime(sT.h, sT.m)}${eT ? ` – ${formatTime(eT.h, eT.m)}` : ""}` : "can’t read that time"}
                  </span>
                </div>
              );
            })}
            <p className="text-[11px]" style={{ color: "var(--g-grey-600)" }}>Blank boxes use the default times above.</p>
          </div>
        </details>
      )}

      <details className="rounded border p-3" style={{ borderColor: "var(--g-grey-300)" }}>
        <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--g-grey-600)" }}>Day labels, location, RSVP deadline, notes (optional)</summary>
        <div className="mt-3 space-y-3">
          <div><label className="label">Day name suffix (days are named “Saturday 8/22”; add e.g. “Time trials” → “Saturday 8/22 · Time trials”)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(none)" className="input" /></div>
          {saved.length > 0 && (
            <div><label className="label">Location — pick a saved place (Team settings) or type one below</label>
              <select value={saved.find((l) => l.name === loc.name)?.id ?? ""} onChange={(e) => pickSaved(e.target.value)} className="input">
                <option value="">(custom / none)</option>
                {saved.map((l) => <option key={l.id} value={l.id}>{l.name}{l.city ? ` — ${l.city}` : ""}</option>)}
              </select></div>
          )}
          <div className="grid grid-cols-[1fr_110px_110px] gap-2">
            <div><label className="label">Location name</label><input value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} placeholder="Fiesta Island (SDYAC)" className="input" /></div>
            <div><label className="label">Lat</label><input value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} className="input" /></div>
            <div><label className="label">Lon</label><input value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: e.target.value })} className="input" /></div>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div><label className="label">RSVP deadline date</label><input type="date" value={deadline.date} onChange={(e) => setDeadline({ ...deadline, date: e.target.value })} className="input" /></div>
            <div><label className="label">Deadline time</label><input value={deadline.time} onChange={(e) => setDeadline({ ...deadline, time: e.target.value })} className="input" /></div>
          </div>
          <div><label className="label">Notes for paddlers</label><RichEditor value={notes} onChange={setNotes} minRows={3} placeholder="Meet 8:00 at Peterson Loop if you need a ride from campus" /></div>
        </div>
      </details>

      {dates.length > 0 && startT && (
        <div className="rounded p-2 text-xs" style={{ background: "var(--g-grey-100)", color: "var(--g-grey-600)" }}>
          {!groupId && <><b>{groupName.trim() || defaultGroupName()}</b> with days: </>}{dates.map((d) => {
            const { sT, eT } = timesFor(d);
            return `${titleFor(d)} (${shortDate(d)} ${sT ? formatTime(sT.h, sT.m) : "?"}${eT ? `–${formatTime(eT.h, eT.m)}` : ""})`;
          }).join(" · ")}
        </div>
      )}
      {error && <p className="text-sm" style={{ color: "var(--g-red)" }}>{error}</p>}
      <button type="button" onClick={submit} disabled={pending || !dates.length} className="btn-primary">{pending ? "Creating…" : groupId ? `Add ${dates.length || ""} day${dates.length === 1 ? "" : "s"}` : `Create event with ${dates.length || ""} day${dates.length === 1 ? "" : "s"}${onCreated ? " & add to form" : ""}`}</button>
    </div>
  );
}
