"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FormQuestion, QuestionType } from "@/lib/database.types";
import type { CampusSpot } from "@/lib/campus-spots";
import LocalTime from "@/components/local-time";
import { deleteForm, saveForm, type FormPayload } from "../actions";
import EventBatchForm from "@/components/event-batch-form";
import Icon from "@/components/icon";
import RichEditor from "@/components/rich-editor";
import RichText from "@/components/rich-text";
import AttendanceFields from "@/components/attendance-fields";
import ConfirmForm from "@/components/confirm-form";
import { attendancePrompt } from "@/lib/attendance";
import { htmlToText } from "@/lib/html";
import { patternError, testPattern } from "@/lib/pattern";
import { NEXT, SUBMIT } from "@/lib/form-sections";
import { DEFAULT_MAX_FILES, DEFAULT_MAX_MB, FILE_KINDS, MAX_FILES_LIMIT, MAX_MB_LIMIT, TEAM_FILES_CAP, maxBytes, maxFiles } from "@/lib/form-files";

type EventOpt = { id: string; title: string; kind: string; starts_at: string; group_id: string | null };
type GroupOpt = { id: string; name: string };
const TYPES: { value: QuestionType; label: string; icon: string }[] = [
  { value: "single_choice", label: "Multiple choice", icon: "◉" },
  { value: "multi_choice", label: "Checkboxes", icon: "☑" },
  { value: "yes_no", label: "Yes / No", icon: "◑" },
  { value: "short_text", label: "Short answer", icon: "―" },
  { value: "long_text", label: "Paragraph", icon: "☰" },
  { value: "number", label: "Number", icon: "#" },
  { value: "file_upload", label: "File upload", icon: "⇪" },
  { value: "info", label: "Info block (no answer)", icon: "¶" },
];
/** Question types whose answer is free text, so an answer pattern means something. */
const PATTERN_TYPES: QuestionType[] = ["short_text", "long_text", "number"];
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
  const lead = qs[0]?.type === "section" ? 1 : 0; // unmarked days belong to section 1
  return { ...p, questions: [...qs.slice(0, lead), ...missing, ...qs.slice(lead)] };
};

// ---- Sections (Google Forms-style; see lib/form-sections.ts) ----
const sectionMarker = (): FormQuestion => ({ id: uid(), type: "section", label: "" });
/** With any section break, questions[0] is the leading marker standing for section 1;
 * with none, there's no leading marker and no leftover navigation settings. */
const normalizeSections = (qs: FormQuestion[]): FormQuestion[] => {
  const breaks = qs.some((q, i) => q.type === "section" && i > 0);
  if (breaks) return qs[0]?.type === "section" ? qs : [sectionMarker(), ...qs];
  return (qs[0]?.type === "section" ? qs.slice(1) : qs).map((q) => (q.branch ? { ...q, branch: undefined } : q));
};
/** After a section is deleted or merged, anything that went to it continues to the next section instead. */
const dropTargets = (qs: FormQuestion[], gone: string) => qs.map((q) => ({
  ...q,
  ...(q.after === gone ? { after: undefined } : {}),
  ...(q.branch ? { branch: Object.fromEntries(Object.entries(q.branch).map(([o, t]) => [o, t === gone ? NEXT : t])) } : {}),
}));
/** Index just past the section that starts at marker index i. */
const sectionEnd = (qs: FormQuestion[], i: number) => { const j = qs.findIndex((q, k) => k > i && q.type === "section"); return j < 0 ? qs.length : j; };

export default function FormEditor({ id, initial, events, groups, pickups }: { id: string; initial: FormPayload; events: EventOpt[]; groups: GroupOpt[]; pickups: CampusSpot[] }) {
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
  /** Hides or brings back a day's attendance question; the day stays on the form either way. */
  const setDayHidden = (eid: string, hidden: boolean) => set("questions", f.questions.map((q) => (q.type === "day" && q.event_id === eid ? { ...q, hidden: hidden || undefined } : q)));
  const setPrompt = (eid: string, prompt: string) => set("events", f.events.map((e) => (e.event_id === eid ? { ...e, prompt: prompt || null } : e)));
  const addQ = () => { const q: FormQuestion = { id: uid(), type: "single_choice", label: "", required: false, options: ["Option 1"] }; set("questions", [...f.questions, q]); setFocus(q.id); };
  const updQ = (qid: string, patch: Partial<FormQuestion>) => set("questions", f.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)));
  const delQ = (qid: string) => set("questions", f.questions.filter((q) => q.id !== qid));
  const dupQ = (qid: string) => { const i = f.questions.findIndex((q) => q.id === qid); const c = { ...f.questions[i], id: uid() }; const a = [...f.questions]; a.splice(i + 1, 0, c); set("questions", a); setFocus(c.id); };
  const moveQ = (i: number, d: -1 | 1) => {
    const a = [...f.questions];
    let j = i + d;
    while (a[j]?.type === "day" && a[j].hidden) j += d; // hidden questions have no card to move past
    if (j < 0 || j >= a.length || (j === 0 && a[0].type === "section")) return;
    const [q] = a.splice(i, 1); a.splice(j, 0, q); set("questions", a);
  };

  // Sections: markers[0] is section 1 (the form header) when the form has sections.
  const markers = f.questions.filter((q) => q.type === "section");
  const nSections = Math.max(1, markers.length);
  const sectionTitle = (m: FormQuestion, k: number) => (k === 0 ? f.title || "Untitled form" : m.label || "Untitled section");
  const targetOptions = [
    <option key={NEXT} value={NEXT}>Continue to next section</option>,
    ...markers.map((m, k) => <option key={m.id} value={m.id}>Go to section {k + 1} ({sectionTitle(m, k)})</option>),
    <option key={SUBMIT} value={SUBMIT}>Submit form</option>,
  ];
  /** Google's "Add section": the break goes after the focused card (or at the end), so the questions below it move into the new section. */
  const addSection = () => {
    const m = sectionMarker();
    const at = focus ? f.questions.findIndex((q) => q.id === focus) : -1;
    const a = [...f.questions];
    a.splice(at < 0 ? a.length : at + 1, 0, m);
    set("questions", normalizeSections(a));
    setFocus(m.id);
  };
  const dupSection = (i: number) => {
    const end = sectionEnd(f.questions, i);
    // A day can only be on the form once, so its attendance question isn't copied.
    const copy = f.questions.slice(i, end).filter((q) => q.type !== "day").map((q) => ({ ...q, id: uid() }));
    const a = [...f.questions]; a.splice(end, 0, ...copy); set("questions", a); setFocus(copy[0].id);
  };
  const deleteSection = (i: number) => {
    if (!window.confirm("Delete questions and section?")) return;
    const end = sectionEnd(f.questions, i);
    const gone = f.questions.slice(i, end);
    // A hidden day has no card in the section, so it stays on the form.
    const kept = gone.filter((q) => q.type === "day" && q.hidden);
    const days = new Set(gone.filter((q) => q.type === "day" && !q.hidden).map((q) => q.event_id));
    setF((s) => ({
      ...s,
      events: s.events.filter((e) => !days.has(e.event_id)),
      questions: normalizeSections(dropTargets([...s.questions.slice(0, i), ...kept, ...s.questions.slice(end)], f.questions[i].id)),
    }));
  };
  const mergeSection = (i: number) => set("questions", normalizeSections(dropTargets(f.questions.filter((_, k) => k !== i), f.questions[i].id)));
  const moveSection = (i: number, d: -1 | 1) => {
    const qs = f.questions; const end = sectionEnd(qs, i);
    if (d === -1) {
      const p = qs.slice(0, i).map((q) => q.type).lastIndexOf("section");
      if (p <= 0) return; // section 1 (the form header) stays first
      set("questions", [...qs.slice(0, p), ...qs.slice(i, end), ...qs.slice(p, i), ...qs.slice(end)]);
    } else {
      if (end >= qs.length) return;
      const nEnd = sectionEnd(qs, end);
      set("questions", [...qs.slice(0, i), ...qs.slice(end, nEnd), ...qs.slice(i, end), ...qs.slice(nEnd)]);
    }
  };
  /** Rename an option and keep its "go to section" target with it. */
  const renameOption = (q: FormQuestion, oi: number, v: string) => {
    const old = q.options![oi];
    const branch = q.branch && old in q.branch ? Object.fromEntries(Object.entries(q.branch).map(([o, t]) => [o === old ? v : o, t])) : q.branch;
    updQ(q.id, { options: q.options!.map((x, k) => (k === oi ? v : x)), branch });
  };
  const branchSelect = (q: FormQuestion, option: string) => q.branch && nSections > 1 && (
    <select value={q.branch[option] ?? NEXT} onClick={(e) => e.stopPropagation()} onChange={(e) => updQ(q.id, { branch: { ...q.branch, [option]: e.target.value } })} className="input w-auto max-w-[45%] py-1 text-xs" aria-label={`After “${option}”`}>
      {targetOptions}
    </select>
  );

  const save = (status = f.status) => start(async () => {
    // Untitled questions are dropped — info blocks only need body text; day markers carry position only.
    const hasLabel = (q: FormQuestion) => !!htmlToText(q.label).trim(); // labels can be rich HTML now
    const questions = f.questions.filter((q) => (q.type === "day" || q.type === "section" ? true : q.type === "info" ? hasLabel(q) || q.help : hasLabel(q)));
    // Keep form_events.sort_order in step with the markers (the grid/CSV/sheet columns follow it).
    const pos = new Map(questions.flatMap((q, i) => (q.type === "day" ? [[q.event_id, i] as const] : [])));
    const eventsSorted = [...f.events].sort((a, b) => (pos.get(a.event_id) ?? -1) - (pos.get(b.event_id) ?? -1));
    const payload = { ...f, status, questions, events: eventsSorted };
    const r = await saveForm(id, payload);
    if (r.error) { setMsg(r.error); return; }
    setF(payload); setMsg(status === "open" ? "Saved — form is open to members" : "Saved"); router.refresh();
  });

  const isTemplate = f.status === "template";
  // The label as plain text is exactly what heads this question's column in the sheet,
  // so a pass here means a parser reading that header will match too.
  const promptMismatch = (q: FormQuestion) => !!q.prompt_pattern && !testPattern(q.prompt_pattern, htmlToText(q.label));
  const mismatches = f.questions.filter(promptMismatch).length;
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
      {mismatches > 0 && <p className="rounded p-2 text-center text-xs" style={{ background: "var(--g-yellow-soft)", color: "#b06000" }}>⚠ {mismatches} question{mismatches > 1 ? "s don’t" : " doesn’t"} match the wording rule {mismatches > 1 ? "they carry" : "it carries"} — anything reading the Google Sheet’s column headers may miss {mismatches > 1 ? "them" : "it"}. You can still save.</p>}

      {/* header card — section 1 once the form has sections */}
      <div>
      {nSections > 1 && <span className="gf-section-tab">Section 1 of {nSections}</span>}
      <div className="gf-header space-y-2">
        <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Untitled form" className="input-line text-[32px] leading-tight" />
        <RichEditor value={f.description} onChange={(html) => set("description", html)} minRows={8} placeholder={"Form description — meetup times, reminders, who to DM…"} />
        {!isTemplate && <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
          <div><label className="label">Due</label><input type="datetime-local" value={toLocal(f.due_at)} onChange={(e) => set("due_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className="input" /></div>
          <div><label className="label">Status</label>
            <select value={f.status} onChange={(e) => set("status", e.target.value as FormPayload["status"])} className="input"><option value="draft">Draft (hidden)</option><option value="open">Open (accepting responses)</option><option value="closed">Closed</option></select></div>
        </div>}
      </div>
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
          const hidden = !!on && f.questions.some((q) => q.type === "day" && q.event_id === ev.id && q.hidden);
          const groupName = ev.group_id ? groups.find((g) => g.id === ev.group_id)?.name : null;
          return (
            <div key={ev.id} className="rounded px-2 py-1" style={{ background: on ? "var(--g-purple-soft)" : undefined }}>
              <label className="gf-radio !py-1">
                <input type="checkbox" checked={!!on} onChange={() => toggleEvent(ev.id)} />
                <span>{ev.title}</span><span className={`text-[10px] ${groupName ? "" : "uppercase"}`} style={{ color: "var(--g-grey-600)" }}>{groupName ?? ev.kind}</span>
                <span className="ml-auto text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={ev.starts_at} /></span>
              </label>
              {hidden
                ? <div className="ml-9 flex items-center gap-2 text-xs" style={{ color: "var(--g-grey-600)" }}>
                    No attendance question for this day
                    <button type="button" onClick={() => setDayHidden(ev.id, false)} className="btn-text py-0.5 text-xs"><Icon name="plus" /> Add question back</button>
                  </div>
                : on && <input value={on.prompt ?? ""} onChange={(e) => setPrompt(ev.id, e.target.value)} placeholder={`Custom prompt (default: “${attendancePrompt(null, ev)}”)`} className="input-line ml-9 w-[calc(100%-2.25rem)] text-xs" />}
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
          <span><Icon name="party" /> birthday</span>
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

      {f.events.length > 0 && pickups.length > 0 && (
        <div className="gf-card space-y-2 text-sm">
          <div className="text-base font-normal"><Icon name="pin" /> On-campus pickup</div>
          <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>
            Riders who need a ride pick On campus or Off campus. Let them choose their own spot (pickup and saved locations), or pick them all up at one place.
          </p>
          <select value={f.campus_pickup ?? ""} onChange={(e) => set("campus_pickup", e.target.value || null)} className="input">
            <option value="">Riders choose their spot</option>
            {pickups.map((p) => <option key={p.id} value={p.id}>Everyone at {p.name}</option>)}
          </select>
        </div>
      )}

      {/* question cards — attendance days and custom questions share one order (↑↓ moves across both) */}
      {f.questions.map((q, i) => {
        if (q.type === "section") {
          if (i === 0) return null; // section 1 is the header card above
          const k = markers.indexOf(q); // 0-based; this card is section k+1
          const prev = markers[k - 1];
          const active = focus === q.id;
          return (
            <div key={q.id} className="space-y-6 pt-2">
              {/* Google's "After section N" — where the section above goes when it's done */}
              <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--g-grey-600)" }}>
                <span>After section {k}</span>
                <select value={prev.after ?? NEXT} onChange={(e) => updQ(prev.id, { after: e.target.value === NEXT ? undefined : e.target.value })} className="input w-auto py-1 text-sm">{targetOptions}</select>
              </div>
              <div>
                <span className="gf-section-tab">Section {k + 1} of {nSections}</span>
                <div onClick={() => setFocus(q.id)} className={`gf-section-card space-y-2 ${active ? "gf-card-active" : ""}`}>
                  <div className="flex items-start gap-2">
                    <input value={q.label} onChange={(e) => updQ(q.id, { label: e.target.value })} placeholder="Untitled section" className="input-line flex-1 text-2xl" aria-label="Section title" />
                    <Menu label="Section options" items={[
                      { label: "Duplicate section", run: () => dupSection(i) },
                      { label: "Move section up", run: () => moveSection(i, -1), disabled: k <= 1 },
                      { label: "Move section down", run: () => moveSection(i, 1), disabled: k >= markers.length - 1 },
                      { label: "Delete section", run: () => deleteSection(i) },
                      { label: "Merge with above", run: () => mergeSection(i) },
                    ]} />
                  </div>
                  {active
                    ? <RichEditor value={q.help ?? ""} onChange={(html) => updQ(q.id, { help: html || undefined })} minRows={2} placeholder="Description (optional)" className="text-sm" />
                    : q.help ? <RichText text={q.help} className="!text-sm" /> : <span className="text-sm" style={{ color: "var(--g-grey-600)" }}>Description (optional)</span>}
                </div>
              </div>
            </div>
          );
        }
        if (q.type === "day") {
          const fe = f.events.find((e) => e.event_id === q.event_id);
          if (!fe || q.hidden) return null;
          const ev = events.find((e) => e.id === fe.event_id);
          const dayIdx = f.questions.slice(0, i).filter((x) => x.type === "day" && !x.hidden).length;
          return (
            <div key={q.id} className="gf-card space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-1 items-baseline gap-2 text-base">
                  <Icon name={dayIdx % 2 ? "moon" : "sun"} />
                  <input value={fe.prompt ?? ""} onChange={(e) => setPrompt(fe.event_id, e.target.value)}
                    placeholder={ev ? attendancePrompt(null, ev) : "Will you be attending this day?"} className="input-line flex-1 text-base" />
                  <span className="gf-required">*</span>
                </div>
                <span className="flex items-center gap-1">
                  <span className="chip !py-0 text-[10px] whitespace-nowrap">Automatic</span>
                  <button type="button" onClick={() => moveQ(i, -1)} disabled={i === 0 || (i === 1 && f.questions[0].type === "section")} className="btn-text py-0.5 disabled:opacity-30" title="Move up"><Icon name="up" /></button>
                  <button type="button" onClick={() => moveQ(i, 1)} disabled={i === f.questions.length - 1} className="btn-text py-0.5 disabled:opacity-30" title="Move down"><Icon name="down" /></button>
                  <Menu label="Attendance question options" items={[
                    { label: "Remove question, keep the day", run: () => setDayHidden(fe.event_id, true) },
                    { label: "Remove day from form", run: () => toggleEvent(fe.event_id) },
                  ]} />
                </span>
              </div>
              {ev && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={ev.starts_at} /> · answers feed attendance, lineups and carpool</p>}
              <fieldset disabled className="pointer-events-none">
                <AttendanceFields prefix={`preview_${fe.event_id}_`} existing={null} pickups={pickups} defaultSeats={3} fixedSpot={f.campus_pickup ?? null} required={false} />
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
                <select value={q.type} onChange={(e) => updQ(q.id, { type: e.target.value as QuestionType, ...(PATTERN_TYPES.includes(e.target.value as QuestionType) ? {} : { answer_pattern: undefined, answer_error: undefined }), options: ["single_choice", "multi_choice"].includes(e.target.value) ? (q.options?.length ? q.options : ["Option 1"]) : undefined, ...(e.target.value === "info" ? { required: false } : {}), ...(e.target.value === "file_upload" ? { max_files: q.max_files ?? DEFAULT_MAX_FILES, max_mb: q.max_mb ?? DEFAULT_MAX_MB } : {}) })} className="input w-48">
                  {TYPES.map((x) => <option key={x.value} value={x.value}>{x.icon} {x.label}</option>)}
                </select>
              )}
            </div>
            {active && <RichEditor value={q.help ?? ""} onChange={(html) => updQ(q.id, { help: html || undefined })} minRows={q.type === "info" ? 5 : 2} placeholder={q.type === "info" ? "Write the info members will read — headings, bullets and links work" : "Description (optional)"} className={q.type === "info" ? "" : "text-xs"} />}
            {!active && q.help && <RichText text={q.help} className={q.type === "info" ? "" : "!text-xs"} />}
            {q.type === "info" && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Read-only info card — members don’t answer anything here.</p>}
            {promptMismatch(q) && <p className="text-xs" style={{ color: "#b06000" }}>⚠ This wording doesn’t match its rule <code>{q.prompt_pattern}</code>.</p>}

            {(q.type === "single_choice" || q.type === "multi_choice") && (
              <div className="space-y-1">
                {(q.options ?? []).map((o, oi) => (
                  <div key={oi} className="flex items-center gap-3">
                    <span className="w-[18px] h-[18px] rounded-full border-2 inline-block" style={{ borderColor: "var(--g-grey-300)", borderRadius: q.type === "multi_choice" ? 3 : 999 }} />
                    {active ? <input value={o} onChange={(e) => renameOption(q, oi, e.target.value)} className="input-line flex-1 !py-1" /> : <span className="flex-1 text-sm py-1">{o}</span>}
                    {q.type === "single_choice" && branchSelect(q, o)}
                    {active && (q.options ?? []).length > 1 && <button type="button" onClick={() => updQ(q.id, { options: q.options!.filter((_, k) => k !== oi), ...(q.branch ? { branch: Object.fromEntries(Object.entries(q.branch).filter(([k]) => k !== o)) } : {}) })} className="px-2" style={{ color: "var(--g-grey-600)" }}>✕</button>}
                  </div>
                ))}
                {active && <button type="button" onClick={() => updQ(q.id, { options: [...(q.options ?? []), `Option ${(q.options?.length ?? 0) + 1}`] })} className="ml-8 text-sm" style={{ color: "var(--g-grey-600)" }}>Add option</button>}
              </div>
            )}
            {q.type === "yes_no" && <div className="text-sm space-y-1" style={{ color: "var(--g-grey-600)" }}>
              {(["yes", "no"] as const).map((v) => <div key={v} className="flex items-center gap-3"><span className="flex-1 capitalize">◯ {v}</span>{branchSelect(q, v)}</div>)}
            </div>}
            {q.type === "file_upload" && <FileSettings q={q} active={active} onChange={(patch) => updQ(q.id, patch)} />}
            {(q.type === "short_text" || q.type === "long_text" || q.type === "number") && <div className="text-sm border-b border-dotted w-1/2 pb-1" style={{ color: "var(--g-grey-600)", borderColor: "var(--g-grey-300)" }}>{t.label} text</div>}

            {active && (
              <div className="flex items-center gap-1 border-t pt-2 text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
                <button type="button" onClick={() => moveQ(i, -1)} disabled={i === 0 || (i === 1 && f.questions[0].type === "section")} className="btn-text disabled:opacity-30"><Icon name="up" /></button>
                <button type="button" onClick={() => moveQ(i, 1)} disabled={i === f.questions.length - 1} className="btn-text disabled:opacity-30"><Icon name="down" /></button>
                <button type="button" onClick={() => dupQ(q.id)} className="btn-text" title="Duplicate"><Icon name="clone" /></button>
                <button type="button" onClick={() => delQ(q.id)} className="btn-text" title="Delete"><Icon name="trash" /></button>
                <span className="flex-1" />
                {q.type !== "info" && <label className="flex items-center gap-2 text-xs"><span>Required</span><input type="checkbox" checked={!!q.required} onChange={(e) => updQ(q.id, { required: e.target.checked })} className="accent-[var(--g-purple)] w-4 h-4" /></label>}
                {nSections > 1 && (q.type === "single_choice" || q.type === "yes_no") && (
                  <Menu label="More options" items={[
                    { label: "Go to section based on answer", checked: !!q.branch, run: () => updQ(q.id, { branch: q.branch ? undefined : {} }) },
                  ]} />
                )}
              </div>
            )}
            {active && q.type !== "info" && <Validation q={q} onChange={(patch) => updQ(q.id, patch)} />}
          </div>
        );
      })}

      <div className="flex justify-center">
        <button type="button" onClick={addQ} className="rounded-full border bg-white px-5 py-2 text-sm font-medium shadow-sm" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>⊕ Add question</button>
        <button type="button" onClick={addSection} title="Starts a new page after the selected question" className="rounded-full border bg-white px-5 py-2 text-sm font-medium shadow-sm" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}>▭ Add section</button>
        {!f.ask_weight && <button type="button" onClick={() => set("ask_weight", true)} className="rounded-full border bg-white px-5 py-2 text-sm font-medium shadow-sm" style={{ borderColor: "var(--g-grey-300)", color: "var(--g-grey-600)" }}><Icon name="weight" /> Add weight question</button>}
      </div>

      <div className="flex justify-between pt-6 text-xs">
        <ConfirmForm action={deleteForm} message={`Delete “${f.title || "this form"}” and all its responses? This can’t be undone.`}><input type="hidden" name="id" value={id} /><button className="btn-danger-text">Delete form</button></ConfirmForm>
        <span style={{ color: "var(--g-grey-600)" }}>Members get name / weight / phone / address from their profile automatically.</span>
      </div>
    </div>
  );
}

/** A File upload question: Google's settings (file types, how many, how big) when
 * selected, a preview of the upload button otherwise. */
function FileSettings({ q, active, onChange }: { q: FormQuestion; active: boolean; onChange: (patch: Partial<FormQuestion>) => void }) {
  const kinds = q.file_kinds ?? [];
  const clamp = (v: string, max: number) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
  const summary = `Up to ${maxFiles(q)} file${maxFiles(q) === 1 ? "" : "s"}, ${maxBytes(q) / 1048576} MB each${kinds.length ? ` · ${FILE_KINDS.filter((k) => kinds.includes(k.key)).map((k) => k.label).join(", ")}` : ""}`;
  if (!active) return (
    <div className="flex items-center gap-3 text-sm" style={{ color: "var(--g-grey-600)" }}>
      <span className="rounded border px-3 py-1" style={{ borderColor: "var(--g-grey-300)" }}>⇪ Add file</span>{summary}
    </div>
  );
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!q.file_kinds} onChange={(e) => onChange({ file_kinds: e.target.checked ? [] : undefined })} className="accent-[var(--g-purple)] w-4 h-4" />
        Allow only specific file types
      </label>
      {q.file_kinds && (
        <div className="ml-6 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {FILE_KINDS.map((k) => (
            <label key={k.key} className="flex items-center gap-2">
              <input type="checkbox" checked={kinds.includes(k.key)} onChange={(e) => onChange({ file_kinds: e.target.checked ? [...kinds, k.key] : kinds.filter((x) => x !== k.key) })} className="accent-[var(--g-purple)] w-4 h-4" />
              {k.label}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2">Maximum number of files
          <input type="number" min={1} max={MAX_FILES_LIMIT} value={maxFiles(q)} onChange={(e) => onChange({ max_files: clamp(e.target.value, MAX_FILES_LIMIT) })} className="input w-20 py-1" />
        </label>
        <label className="flex items-center gap-2">Maximum file size (MB)
          <input type="number" min={1} max={MAX_MB_LIMIT} value={maxBytes(q) / 1048576} onChange={(e) => onChange({ max_mb: clamp(e.target.value, MAX_MB_LIMIT) })} className="input w-20 py-1" />
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Files are private — only team admins and the person who uploaded them can open them. Up to {MAX_FILES_LIMIT} files and {MAX_MB_LIMIT} MB per file; the team has {TEAM_FILES_CAP / 1048576} MB of uploads in total.</p>
    </div>
  );
}

/** Regex rules for one question: what its answer must look like, and what its own
 * wording must keep saying. Opens by itself when a rule is already set. */
function Validation({ q, onChange }: { q: FormQuestion; onChange: (patch: Partial<FormQuestion>) => void }) {
  const hasRule = !!(q.answer_pattern || q.prompt_pattern);
  const [open, setOpen] = useState(hasRule);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="text-xs">
      <summary className="cursor-pointer select-none" style={{ color: "var(--g-grey-600)" }}>Validation{hasRule ? " (on)" : ""}</summary>
      <div className="mt-2 space-y-3">
        <p style={{ color: "var(--g-grey-600)" }}>Patterns are regular expressions, written bare or as <code>/pattern/flags</code> (flags: i, m, s, u). They match anywhere in the text — wrap in <code>^…$</code> to require the whole thing.</p>
        {PATTERN_TYPES.includes(q.type) && <>
          <PatternField label="Answer must match" value={q.answer_pattern} onChange={(v) => onChange({ answer_pattern: v })} />
          {q.answer_pattern && <div><label className="label">Error message shown to members</label>
            <input value={q.answer_error ?? ""} onChange={(e) => onChange({ answer_error: e.target.value || undefined })} placeholder={`“${htmlToText(q.label) || "This question"}” isn’t in the expected format.`} className="input-line w-full" /></div>}
        </>}
        <PatternField label="Question wording must match" hint="Carried into every form made from this one. A mismatch warns but never blocks saving." value={q.prompt_pattern} onChange={(v) => onChange({ prompt_pattern: v })} sample={htmlToText(q.label)} />
      </div>
    </details>
  );
}

/** One pattern input with its compile error and a sample to try it against. `sample`
 * seeds the tester (the question's wording, for the wording rule). */
function PatternField({ label, hint, value, onChange, sample: seed = "" }: { label: string; hint?: string; value?: string; onChange: (v: string | undefined) => void; sample?: string }) {
  const [sample, setSample] = useState<string | null>(null);
  const text = sample ?? seed;
  const err = patternError(value);
  return (
    <div className="space-y-1">
      <label className="label">{label}</label>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder="e.g. /^\d{3}-\d{4}$/" className="input-line w-full font-mono" spellCheck={false} />
      {hint && <p style={{ color: "var(--g-grey-600)" }}>{hint}</p>}
      {err && <p style={{ color: "var(--g-red)" }}>{err}</p>}
      {value && !err && (
        <div className="flex items-center gap-2">
          <input value={text} onChange={(e) => setSample(e.target.value)} placeholder="Try a sample…" className="input-line flex-1" />
          {text && (testPattern(value, text)
            ? <span style={{ color: "var(--g-green)" }}>✓ matches</span>
            : <span style={{ color: "var(--g-red)" }}>✗ no match</span>)}
        </div>
      )}
    </div>
  );
}

/** Google-style ⋮ menu: a few actions, optionally with a checkmark (like "Go to section based on answer"). */
function Menu({ label, items }: { label: string; items: { label: string; run: () => void; disabled?: boolean; checked?: boolean }[] }) {
  return (
    <details className="relative" onClick={(e) => e.stopPropagation()}>
      <summary className="btn-text list-none cursor-pointer py-0.5" aria-label={label} title={label}><Icon name="dots" /></summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-white py-1 text-sm shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
        {items.map((it) => (
          <button key={it.label} type="button" disabled={it.disabled} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50 disabled:opacity-40"
            onClick={(e) => { it.run(); e.currentTarget.closest("details")?.removeAttribute("open"); }}>
            {it.checked !== undefined && <span className="w-4">{it.checked ? <Icon name="check" /> : null}</span>}{it.label}
          </button>
        ))}
      </div>
    </details>
  );
}
