"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEventDay } from "@/app/(app)/admin/actions";
import { combineLocal, formatTime, parseTimeText } from "@/lib/time";
import RichEditor from "@/components/rich-editor";
import type { Event, SavedLocation } from "@/lib/database.types";
import Icon from "@/components/icon";

import { dayKey } from "@/lib/calendar-dates";

const localDate = (iso: string) => dayKey(iso); // yyyy-mm-dd, viewer-local
const localTime = (iso: string) => { const d = new Date(iso); return formatTime(d.getHours(), d.getMinutes()); };

/** ✎ button on a day card (group overview) that expands into an inline editor for that day. */
export default function EditDay({ event, saved }: { event: Event; saved: SavedLocation[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(localDate(event.starts_at));
  const [start, setStart] = useState(localTime(event.starts_at));
  const [end, setEnd] = useState(event.ends_at ? localTime(event.ends_at) : "");
  const [deadline, setDeadline] = useState(event.rsvp_deadline ? { date: localDate(event.rsvp_deadline), time: localTime(event.rsvp_deadline) } : { date: "", time: "11:59pm" });
  const [loc, setLoc] = useState({ name: event.location_name ?? "", lat: event.location_lat != null ? String(event.location_lat) : "", lon: event.location_lon != null ? String(event.location_lon) : "" });
  const [notes, setNotes] = useState(event.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();

  const startT = parseTimeText(start), endT = end ? parseTimeText(end) : null;
  const pickSaved = (id: string) => {
    const l = saved.find((x) => x.id === id);
    if (l) setLoc({ name: l.name, lat: l.lat != null ? String(l.lat) : "", lon: l.lon != null ? String(l.lon) : "" });
  };
  const submit = () => {
    setError(null);
    if (!date || !startT) return setError("Check the date and start time (e.g. 8:45am).");
    if (end && !endT) return setError("End time looks off — try “11am”.");
    run(async () => {
      const r = await updateEventDay({
        id: event.id, title, starts_at: combineLocal(date, start)!, ends_at: end ? combineLocal(date, end) : null,
        rsvp_deadline: deadline.date ? combineLocal(deadline.date, deadline.time || "11:59pm") : null,
        location_name: loc.name.trim() || null, location_lat: loc.lat ? Number(loc.lat) : null, location_lon: loc.lon ? Number(loc.lon) : null,
        notes: notes.trim() || null,
      });
      if (r.error) { setError(r.error); return; }
      setOpen(false); router.refresh();
    });
  };

  if (!open) return <button onClick={() => setOpen(true)} className="btn-text py-0.5 text-xs" title="Edit this day"><Icon name="pen" /></button>;
  return (
    <>
      <button onClick={() => setOpen(false)} className="btn-text py-0.5 text-xs" title="Close"><Icon name="pen" /></button>
      <div className="absolute right-0 top-6 z-10 w-[26rem] max-w-[85vw] space-y-2 rounded-lg border bg-white p-3 text-left text-sm font-normal shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
        <div><label className="label">Day name</label><input value={title} onChange={(e) => setTitle(e.target.value)} className="input" /></div>
        <div className="grid grid-cols-[1fr_90px_90px] gap-2">
          <div><label className="label">Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" /></div>
          <div><label className="label">Start</label><input value={start} onChange={(e) => setStart(e.target.value)} className="input" />
            <div className="text-xs mt-0.5" style={{ color: startT ? "var(--g-grey-600)" : "var(--g-red)" }}>{startT ? `= ${formatTime(startT.h, startT.m)}` : "8:45am?"}</div></div>
          <div><label className="label">End</label><input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="(none)" className="input" />
            <div className="text-xs mt-0.5" style={{ color: !end || endT ? "var(--g-grey-600)" : "var(--g-red)" }}>{endT ? `= ${formatTime(endT.h, endT.m)}` : " "}</div></div>
        </div>
        {saved.length > 0 && (
          <div><label className="label">Location — saved place or type below</label>
            <select value={saved.find((l) => l.name === loc.name)?.id ?? ""} onChange={(e) => pickSaved(e.target.value)} className="input">
              <option value="">(custom / none)</option>
              {saved.map((l) => <option key={l.id} value={l.id}>{l.name}{l.city ? ` — ${l.city}` : ""}</option>)}
            </select></div>
        )}
        <div className="grid grid-cols-[1fr_90px_90px] gap-2">
          <div><label className="label">Location name</label><input value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} className="input" /></div>
          <div><label className="label">Lat</label><input value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} className="input" /></div>
          <div><label className="label">Lon</label><input value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: e.target.value })} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">RSVP deadline date</label><input type="date" value={deadline.date} onChange={(e) => setDeadline({ ...deadline, date: e.target.value })} className="input" /></div>
          <div><label className="label">Deadline time</label><input value={deadline.time} onChange={(e) => setDeadline({ ...deadline, time: e.target.value })} className="input" /></div>
        </div>
        <div><label className="label">Notes for paddlers</label><RichEditor value={notes} onChange={setNotes} minRows={2} /></div>
        {error && <p style={{ color: "var(--g-red)" }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-text">Cancel</button>
          <button onClick={submit} disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save day"}</button>
        </div>
      </div>
    </>
  );
}
