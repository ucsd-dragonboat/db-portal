"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FormQuestion, PickupLocation, QuestionType } from "@/lib/database.types";
import LocalTime from "@/components/local-time";
import { deleteForm, saveForm, type FormPayload } from "../actions";
import EventBatchForm from "@/components/event-batch-form";
import Icon from "@/components/icon";
import RichEditor from "@/components/rich-editor";
import RichText from "@/components/rich-text";
import AttendanceFields from "@/components/attendance-fields";
import ConfirmForm from "@/components/confirm-form";
import { htmlToText } from "@/lib/html";

type EventOpt = { id: string; title: string; kind: string; starts_at: string; group_id: string | null };
type GroupOpt = { id: string; name: string };
const TYPES: { value: QuestionType; label: string; icon: string }[] = [
  { value: "single_choice", label: "Multiple choice", icon: "◉" },
  { value: "multi_choice", label: "Checkboxes", icon: "☑" },
  { value: "yes_no", label: "Yes / No", icon: "◑" },
  { value: "short_text", label: "Short answer", icon: "―" },
  { value: "long_text", label: "Paragraph", icon: "☰" },
  { value: "number", label: "Number", icon: "#" },
  { value: "info", label: "Info block (no answer)", icon: "¶" },
];
const uid = () => Math.random().toString(36).slice(2, 9);
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

const dayMarker = (event_id: string): FormQuestion => ({ id: `day_${event_id}`, type: "day", label: "", event_id });
/** Every linked day gets a "day" marker in the questions list — its position IS the
 * attendance question's position, so days and custom questions reorder together.
 * Drops stale markers; days without one (older forms) go first, like before. */
const withDayMarkers = (p: FormPayload): FormPayload => {
  const qs = p.questions.filter((q) => q.type !== "day" || p.events.some((e) => e.event_id === q.event_id));
  const marked = new Set(qs.filter((q) => q.type === "day").map((q) => q.event_id));
  const missing = p.events.filter((e) => !marked.has(e.event_id)).map((e) => dayMarker(e.event_id));
  return { ...p, questions: [...missing, ...qs] };
};

export default function FormEditor({ id, initial, events, groups, pickups }: { id: string; initial: FormPayload; events: EventOpt[]; groups: GroupOpt[]; pickups: PickupLocation[] }) {
  const router = useRouter();
  const [f, setF] = useState<FormPayload>(() => withDayMarkers(initial));
  const [focus, setFocus] = useState<string | null>(null);
  const [addingDays, setAddingDays] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof FormPayload>(k: K, v: FormPayload[K]) => setF((s) => ({ ...s, [k]: v }));

  const addDays = (ids: string[]) => setF((s) => ({
    ...s,
    events: [...s.events, ...ids.map((event_id) => ({ event_id, prompt: null }))],
    questions: [...s.questions, ...ids.map(dayMarker)],
  }));
  const addGroup = (gid: string) => {
    if (!gid) return;
    const ids = events.filter((e) => e.group_id === gid).map((e) => e.id).filter((eid) => !f.events.some((x) => x.event_id === eid));
    addDays(ids);
    setMsg(`Added ${ids.length} day(s)`);
  };
  const toggleEvent = (eid: string) => setF((s) => s.events.some((e) => e.event_id === eid)
    ? { ...s, events: s.events.filter((e) => e.event_id !== eid), questions: s.questions.filter((q) => !(q.type === "day" && q.event_id === eid)) }
    : { ...s, events: [...s.events, { event_id: eid, prompt: null }], questions: [...s.questions, dayMarker(eid)] });
  const setPrompt = (eid: string, prompt: string) => set("events", f.events.map((e) => (e.event_id === eid ? { ...e, prompt: prompt || null } : e)));
  const addQ = () => { const q: FormQuestion = { id: uid(), type: "single_choice", label: "", required: true, options: ["Option 1"] }; set("questions", [...f.questions, q]); setFocus(q.id); };
  const updQ = (qid: string, patch: Partial<FormQuestion>) => set("questions", f.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)));
  const delQ = (qid: string) => set("questions", f.questions.filter((q) => q.id !== qid));
  const dupQ = (qid: string) => { const i = f.questions.findIndex((q) => q.id === qid); const c = { ...f.questions[i], id: uid() }; const a = [...f.questions]; a.splice(i + 1, 0, c); set("questions", a); setFocus(c.id); };
  const moveQ = (i: number, d: -1 | 1) => { const a = [...f.questions]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set("questions", a); };

  const save = (status = f.status) => start(async () => {
    // Untitled questions are dropped — info blocks only need body text; day markers carry position only.
    const hasLabel = (q: FormQuestion) => !!htmlToText(q.label).trim(); // labels can be rich HTML now
    const questions = f.questions.filter((q) => (q.type === "day" ? true : q.type === "info" ? hasLabel(q) || q.help : hasLabel(q)));
    // Keep form_events.sort_order in step with the markers (the grid/CSV/sheet columns follow it).
    const pos = new Map(questions.flatMap((q, i) => (q.type === "day" ? [[q.event_id, i] as const] : [])));
    const eventsSorted = [...f.events].sort((a, b) => (pos.get(a.event_id) ?? -1) - (pos.get(b.event_id) ?? -1));
    const payload = { ...f, status, questions, events: eventsSorted };
    const r = await saveForm(id, payload);
    if (r.error) { setMsg(r.error); return; }
    setF(payload); setMsg(status === "open" ? "Saved — form is open to members" : "Saved"); router.refresh();
  });

  const isTemplate = f.status === "template";
  const statusChip = { draft: ["Draft", "var(--g-grey-100)", "var(--g-grey-600)"], open: ["Accepting responses", "var(--g-green-soft)", "var(--g-green)"], closed: ["Closed", "#fef7e0", "#b06000"], template: ["Template", "var(--g-purple-soft)", "var(--g-purple)"] }[f.status];

  return (
    <div className="mx-auto max-w-[760px] space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="chip" style={{ background: statusChip[1], color: statusChip[2], borderColor: "transparent" }}>{statusChip[0]}</span>
        <span className="flex-1" />
        <Link href={`/forms/${id}`} className="btn-text"><Icon name="eye" /> Preview</Link>
        <button type="button" onClick={() => save()} disabled={pending} className="btn-secondary">Save</button>
        {!isTemplate && f.status !== "open" && <button type="button" onClick={() => save("open")} disabled={pending} className="btn-purple">Send</button>}
        {f.status === "open" && <button type="button" onClick={() => save("closed")} disabled={pending} className="btn-secondary">Stop accepting responses</button>}
      </div>
      {isTemplate && <p className="rounded bg-white/70 p-2 text-center text-xs" style={{ color: "var(--g-grey-600)" }}>Template — edits here change how new forms start when an admin picks this card. Days are added on each form, not on the template.</p>}
      {msg && <p className="text-xs text-center" style={{ color: "var(--g-green)" }}>{msg}</p>}

      {/* header card */}
      <div className="gf-header space-y-2">
        <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Untitled form" className="input-line text-[32px] leading-tight" />
        <RichEditor value={f.description} onChange={(html) => set("description", html)} minRows={8} placeholder={"Form description — meetup times, reminders, who to DM…"} />
        {!isTemplate && <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
          <div><label className="label">Due</label><input type="datetime-local" value={toLocal(f.due_at)} onChange={(e) => set("due_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className="input" /></div>
          <div><label className="label">Status</label>
            <select value={f.status} onChange={(e) => set("status", e.target.value as FormPayload["status"])} className="input"><option value="draft">Draft (hidden)</option><option value="open">Open (accepting responses)</option><option value="closed">Closed</option></select></div>
        </div>}
      </div>

      {/* events card */}
      {!isTemplate && <div className="gf-card space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-base"><Icon name="calendar" /> Days / events on this form <span className="gf-required">*</span></div>
          <div className="flex items-center gap-1">
            {groups.length > 0 && (
              <select value="" onChange={(e) => addGroup(e.target.value)} className="input w-auto py-1 text-xs">
                <option value="">Add all days of an event…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setAddingDays((v) => !v)} className="btn-text">{addingDays ? "Cancel" : <><Icon name="plus" /> New event & days</>}</button>
          </div>
        </div>
        <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Each checked day gets its own “Will you be attending?” question (drive others / own ride / need a ride + pickup spot), so people can answer per day. Answers feed attendance, lineups and carpool.</p>
        {addingDays && (
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--g-purple)", background: "var(--g-grey-50)" }}>
            <EventBatchForm compact onCreated={(ids) => { addDays(ids); setAddingDays(false); setMsg(`Added ${ids.length} day(s) — remember to Save`); }} />
          </div>
        )}
        {!events.length && !addingDays && <p className="text-sm" style={{ color: "var(--g-red)" }}>No upcoming events yet — click “New event & days”.</p>}
        {events.map((ev) => {
          const on = f.events.find((e) => e.event_id === ev.id);
          const groupName = ev.group_id ? groups.find((g) => g.id === ev.group_id)?.name : null;
          return (
            <div key={ev.id} className="rounded px-2 py-1" style={{ background: on ? "var(--g-purple-soft)" : undefined }}>
              <label className="gf-radio !py-1">
                <input type="checkbox" checked={!!on} onChange={() => toggleEvent(ev.id)} />
                <span>{ev.title}</span><span className={`text-[10px] ${groupName ? "" : "uppercase"}`} style={{ color: "var(--g-grey-600)" }}>{groupName ?? ev.kind}</span>
                <span className="ml-auto text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={ev.starts_at} /></span>
              </label>
              {on && <input value={on.prompt ?? ""} onChange={(e) => setPrompt(ev.id, e.target.value)} placeholder={`Custom prompt (default: “Will you be attending ${ev.title}?”)`} className="input-line ml-9 w-[calc(100%-2.25rem)] text-xs" />}
            </div>
          );
        })}
      </div>}

      {/* automatic questions — rendered exactly as members will see them */}
      <div className="gf-card text-sm">
        <div className="flex items-center justify-between">
          <div className="font-medium text-base">Your info</div>
          <span className="chip !py-0 text-[10px]">Automatic</span>
        </div>
        <p className="text-xs mb-2" style={{ color: "var(--g-grey-600)" }}>Pulled from each member’s profile so we don’t ask every week.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ color: "var(--g-grey-600)" }}>
          <span><Icon name="user" /> Member’s name</span><span><Icon name="phone" /> phone</span>
          <span><Icon name="weight" /> weight</span><span><Icon name="house" /> address</span>
        </div>
      </div>

      {f.ask_weight && (
        <div className="gf-card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-base font-normal"><Icon name="weight" /> What&apos;s your current weight? (lb)</div>
            <button type="button" onClick={() => set("ask_weight", false)} className="btn-text py-0.5" title="Delete"><Icon name="trash" /></button>
          </div>
          <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Coaches need this to make lineups. Leave as-is if unchanged — saved to your profile.</p>
          <input type="number" disabled placeholder="Your answer" className="input-line w-1/2" />
        </div>
      )}

      {/* question cards — attendance days and custom questions share one order (↑↓ moves across both) */}
      {f.questions.map((q, i) => {
        if (q.type === "day") {
          const fe = f.events.find((e) => e.event_id === q.event_id);
          if (!fe) return null;
          const ev = events.find((e) => e.id === fe.event_id);
          const dayIdx = f.questions.slice(0, i).filter((x) => x.type === "day").length;
          return (
            <div key={q.id} className="gf-card space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-1 items-baseline gap-2 text-base">
                  <Icon name={dayIdx % 2 ? "moon" : "sun"} />
                  <input value={fe.prompt ?? ""} onChange={(e) => setPrompt(fe.event_id, e.target.value)}
                    placeholder={`Will you be attending ${ev?.title ?? "this day"}?`} className="input-line flex-1 text-base" />
                  <span className="gf-required">*</span>
                </div>
                <span className="flex items-center gap-1">
                  <span className="chip !py-0 text-[10px] whitespace-nowrap">Automatic</span>
                  <button type="button" onClick={() => moveQ(i, -1)} disabled={i === 0} className="btn-text py-0.5 disabled:opacity-30" title="Move up"><Icon name="up" /></button>
                  <button type="button" onClick={() => moveQ(i, 1)} disabled={i === f.questions.length - 1} className="btn-text py-0.5 disabled:opacity-30" title="Move down"><Icon name="down" /></button>
                  <button type="button" onClick={() => toggleEvent(fe.event_id)} className="btn-text py-0.5" title="Remove this day from the form"><Icon name="trash" /></button>
                </span>
              </div>
              {ev && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={ev.starts_at} /> · answers feed attendance, lineups and carpool</p>}
              <fieldset disabled className="pointer-events-none">
                <AttendanceFields prefix={`preview_${fe.event_id}_`} existing={null} pickups={pickups} defaultSeats={3} required={false} />
              </fieldset>
            </div>
          );
        }
        const active = focus === q.id;
        const t = TYPES.find((x) => x.value === q.type)!;
        return (
          <div key={q.id} onClick={() => setFocus(q.id)} className={`gf-card ${active ? "gf-card-active" : ""} space-y-3`}>
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                {active
                  ? <RichEditor value={q.label} onChange={(html) => updQ(q.id, { label: html })} minRows={1} placeholder={q.type === "info" ? "Title (optional)" : "Question"} />
                  : htmlToText(q.label).trim()
                    ? <RichText text={q.label} className="!text-base" />
                    : <span className="text-base" style={{ color: "var(--g-grey-600)" }}>{q.type === "info" ? "Title (optional)" : "Question"}</span>}
              </div>
              {active && (
                <select value={q.type} onChange={(e) => updQ(q.id, { type: e.target.value as QuestionType, options: ["single_choice", "multi_choice"].includes(e.target.value) ? (q.options?.length ? q.options : ["Option 1"]) : undefined, ...(e.target.value === "info" ? { required: false } : {}) })} className="input w-48">
                  {TYPES.map((x) => <option key={x.value} value={x.value}>{x.icon} {x.label}</option>)}
                </select>
              )}
            </div>
            {active && <RichEditor value={q.help ?? ""} onChange={(html) => updQ(q.id, { help: html || undefined })} minRows={q.type === "info" ? 5 : 2} placeholder={q.type === "info" ? "Write the info members will read — headings, bullets and links work" : "Description (optional)"} className={q.type === "info" ? "" : "text-xs"} />}
            {!active && q.help && <RichText text={q.help} className={q.type === "info" ? "" : "!text-xs"} />}
            {q.type === "info" && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Read-only info card — members don’t answer anything here.</p>}

            {(q.type === "single_choice" || q.type === "multi_choice") && (
              <div className="space-y-1">
                {(q.options ?? []).map((o, oi) => (
                  <div key={oi} className="flex items-center gap-3">
                    <span className="w-[18px] h-[18px] rounded-full border-2 inline-block" style={{ borderColor: "var(--g-grey-300)", borderRadius: q.type === "multi_choice" ? 3 : 999 }} />
                    {active ? <input value={o} onChange={(e) => updQ(q.id, { options: q.options!.map((x, k) => (k === oi ? e.target.value : x)) })} className="input-line flex-1 !py-1" /> : <span className="text-sm py-1">{o}</span>}
                    {active && (q.options ?? []).length > 1 && <button type="button" onClick={() => updQ(q.id, { options: q.options!.filter((_, k) => k !== oi) })} className="px-2" style={{ color: "var(--g-grey-600)" }}>✕</button>}
                  </div>
                ))}
                {active && <button type="button" onClick={() => updQ(q.id, { options: [...(q.options ?? []), `Option ${(q.options?.length ?? 0) + 1}`] })} className="ml-8 text-sm" style={{ color: "var(--g-grey-600)" }}>Add option</button>}
              </div>
            )}
            {q.type === "yes_no" && <div className="text-sm space-y-1" style={{ color: "var(--g-grey-600)" }}><div>◯ Yes</div><div>◯ No</div></div>}
            {(q.type === "short_text" || q.type === "long_text" || q.type === "number") && <div className="text-sm border-b border-dotted w-1/2 pb-1" style={{ color: "var(--g-grey-600)", borderColor: "var(--g-grey-300)" }}>{t.label} text</div>}

            {active && (
              <div className="flex items-center gap-1 border-t pt-2 text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
                <button type="button" onClick={() => moveQ(i, -1)} disabled={i === 0} className="btn-text disabled:opacity-30"><Icon name="up" /></button>
                <button type="button" onClick={() => moveQ(i, 1)} disabled={i === f.questions.length - 1} className="btn-text disabled:opacity-30"><Icon name="down" /></button>
                <button type="button" onClick={() => dupQ(q.id)} className="btn-text" title="Duplicate"><Icon name="clone" /></button>
                <button type="button" onClick={() => delQ(q.id)} className="btn-text" title="Delete"><Icon name="trash" /></button>
                <span className="flex-1" />
                {q.type !== "info" && <label className="flex items-center gap-2 text-xs"><span>Required</span><input type="checkbox" checked={!!q.required} onChange={(e) => updQ(q.id, { required: e.target.checked })} className="accent-[var(--g-purple)] w-4 h-4" /></label>}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex justify-center">
        <button type="button" onClick={addQ} className="rounded-full border bg-white px-5 py-2 text-sm font-medium shadow-sm" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>⊕ Add question</button>
        {!f.ask_weight && <button type="button" onClick={() => set("ask_weight", true)} className="rounded-full border bg-white px-5 py-2 text-sm font-medium shadow-sm" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}><Icon name="weight" /> Add weight question</button>}
      </div>

      <div className="flex justify-between pt-6 text-xs">
        <ConfirmForm action={deleteForm} message={`Delete “${f.title || "this form"}” and all its responses? This can’t be undone.`}><input type="hidden" name="id" value={id} /><button className="btn-danger-text">Delete form</button></ConfirmForm>
        <span style={{ color: "var(--g-grey-600)" }}>Members get name / weight / phone / address from their profile automatically.</span>
      </div>
    </div>
  );
}
