"use client";

import { useActionState, useRef, useState } from "react";
import dynamic from "next/dynamic";
import RichTextView from "@/components/rich-text-view";

// Lazy: tiptap only downloads when the form actually has a paragraph question.
const RichEditor = dynamic(() => import("@/components/rich-editor"), {
  ssr: false,
  loading: () => <div className="input-line w-full text-sm" style={{ color: "var(--g-grey-600)" }}>Loading editor…</div>,
});
import { submitForm, type SubmitState } from "./actions";
import AttendanceFields from "@/components/attendance-fields";
import { attendancePrompt } from "@/lib/attendance";
import LocalTime from "@/components/local-time";
import type { Event, FormQuestion, Rsvp } from "@/lib/database.types";
import type { CampusSpot } from "@/lib/campus-spots";
import Icon from "@/components/icon";
import { SUBMIT, nextTarget, splitSections } from "@/lib/form-sections";

const Q = ({ title, required, help, meta, children, group, missing }: {
  title: React.ReactNode; required?: boolean; help?: string; meta?: React.ReactNode; children: React.ReactNode;
  /** A required answer the browser can't check itself (paragraph, checkboxes): checked on Next/Submit. */
  group?: string; missing?: boolean;
}) => (
  <div className="gf-card space-y-3" data-required-group={group} style={missing ? { borderColor: "var(--g-red)" } : undefined}>
    <div className="text-base font-normal">{title}{required && <span className="gf-required"> *</span>}</div>
    {meta && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>{meta}</p>}
    {help && <RichTextView html={help} className="!text-xs" />}
    {children}
    {missing && <p className="text-xs" style={{ color: "var(--g-red)" }}><Icon name="due" /> This is a required question</p>}
  </div>
);

function ParagraphAnswer({ name, initial }: { name: string; initial: string }) {
  const [v, setV] = useState(initial);
  return (<><input type="hidden" name={name} value={v} /><RichEditor value={v} onChange={setV} minRows={3} placeholder="Your answer" /></>);
}

export default function FillForm({ formId, events, rsvpBy, questions, existingAnswers, pickups, defaultSeats, weightLb, askWeight, askBirthday = false, defaultPickupId = null, campusPickup = null, submittedAt, submitAction = submitForm, header, savedMessage, titleCard, laterTitleCard, intro }: {
  formId: string; events: { prompt: string | null; event: Event }[]; rsvpBy: Record<string, Rsvp>; questions: FormQuestion[];
  existingAnswers: Record<string, unknown> | null; pickups: CampusSpot[]; defaultSeats: number | null; weightLb: number | null; askWeight: boolean; submittedAt: string | null;
  /** The member has no birthday on their profile yet (or is anonymous): ask for it, required. */
  askBirthday?: boolean;
  /** The member's saved default pickup spot, preselected for "I need a ride". */
  defaultPickupId?: string | null;
  /** The form creator's fixed on-campus pickup spot (forms.campus_pickup); null = riders choose. */
  campusPickup?: string | null;
  /** Public (shared-link) forms submit through a different action and show an email/name block first. */
  submitAction?: (state: SubmitState, fd: FormData) => Promise<SubmitState>; header?: React.ReactNode;
  /** Replaces the default "Your response has been recorded…" confirmation. */
  savedMessage?: React.ReactNode;
  /** The form's title card, on top of every page (`laterTitleCard` replaces it after page
   * 1, like Google Forms showing the description only on the first page). */
  titleCard?: React.ReactNode; laterTitleCard?: React.ReactNode;
  /** Cards shown only on page 1, under the title card. */
  intro?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitAction, {});
  const a = (id: string) => existingAnswers?.[id];

  // Attendance days and custom questions share one sequence: "day" markers in the
  // questions list position each day; days without a marker (older forms) come first.
  // Section markers split them into pages (lib/form-sections.ts); a leading marker stays
  // first so unmarked days land in section 1.
  type FormItem = { day: { prompt: string | null; event: Event } } | { q: FormQuestion };
  const dayByEvent = new Map(events.map((e) => [e.event.id, e]));
  const marked = new Set(questions.filter((q) => q.type === "day").map((q) => q.event_id));
  const lead = questions[0]?.type === "section" ? [questions[0]] : [];
  const items: FormItem[] = [
    ...lead.map((q) => ({ q })),
    ...events.filter((e) => !marked.has(e.event.id)).map((e) => ({ day: e })),
    ...questions.slice(lead.length).flatMap<FormItem>((q) => q.type === "day"
      ? (q.event_id && dayByEvent.has(q.event_id) ? [{ day: dayByEvent.get(q.event_id)! }] : [])
      : [{ q }]),
  ];
  const questionOf = (it: FormItem) => ("q" in it ? it.q : null);
  const sections = splitSections(items, questionOf);
  const paged = sections.length > 1;

  // Google Forms paging: `history` is the sections actually visited (Back retraces it).
  // Every section stays mounted so answers survive Back; unvisited ones are disabled
  // fieldsets, so they're neither validated nor submitted.
  const formRef = useRef<HTMLFormElement>(null);
  const pageRefs = useRef<(HTMLFieldSetElement | null)[]>([]);
  const [history, setHistory] = useState([0]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const current = history[history.length - 1];
  const savedValue = (qid: string) => { const v = existingAnswers?.[qid]; return v === true ? "yes" : v === false ? "no" : v; };
  const targetFrom = (page: number) => nextTarget(sections, page, questionOf,
    formRef.current ? ((qid) => new FormData(formRef.current!).get(`q_${qid}`)) : savedValue);
  const [target, setTarget] = useState(() => nextTarget(sections, 0, questionOf, savedValue));

  /** Required answers the browser can't check (paragraphs, checkbox groups) on this page. */
  const pageMissing = (page: number) => [...(pageRefs.current[page]?.querySelectorAll<HTMLElement>("[data-required-group]") ?? [])]
    .filter((el) => ![...el.querySelectorAll<HTMLInputElement>("input")].some((i) => (i.type === "checkbox" ? i.checked : i.type === "hidden" && i.value.trim())))
    .map((el) => el.dataset.requiredGroup!);
  const pageValid = (page: number) => {
    const miss = pageMissing(page);
    setMissing(new Set(miss));
    if (miss.length) { pageRefs.current[page]?.querySelector(`[data-required-group="${miss[0]}"]`)?.scrollIntoView({ block: "center" }); return false; }
    // A fieldset's own reportValidity() always passes (fieldsets are exempt), so check each control.
    const bad = [...(pageRefs.current[page]?.elements ?? [])].find((el) => !(el as HTMLInputElement).checkValidity?.());
    if (bad) { (bad as HTMLInputElement).reportValidity(); return false; }
    return true;
  };
  const goNext = () => {
    if (!pageValid(current)) return;
    const t = targetFrom(current);
    if (t === SUBMIT) return;
    setHistory((h) => [...h, t]);
    setTarget(targetFrom(t));
    window.scrollTo({ top: 0 });
  };
  const goBack = () => {
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setMissing(new Set());
    setTarget(targetFrom(prev));
    window.scrollTo({ top: 0 });
  };

  // Days alternate sun/moon icons in form order, across pages.
  const dayIdxOf = new Map(items.flatMap((it) => ("day" in it ? [it.day.event.id] : [])).map((id, i) => [id, i]));
  const renderItem = (it: FormItem) => {
    if ("day" in it) {
      const { event, prompt } = it.day;
      const dayIdx = dayIdxOf.get(event.id) ?? 0;
      return (
        <Q key={event.id} required title={prompt || <><Icon name={dayIdx % 2 ? "moon" : "sun"} /> {attendancePrompt(null, event)}</>}
          meta={<><LocalTime iso={event.starts_at} />{event.location_name && <> · <Icon name="pin" /> {event.location_name}</>}</>} help={event.notes ?? undefined}>
          <AttendanceFields prefix={`ev_${event.id}_`} existing={rsvpBy[event.id] ?? null} pickups={pickups} defaultSeats={defaultSeats} defaultPickupId={defaultPickupId} fixedSpot={campusPickup} />
        </Q>
      );
    }
    const q = it.q;
    if (q.type === "info") return (
      // Read-only info card — admin-authored rich text, nothing to answer.
      <div key={q.id} className="gf-card space-y-2">
        {q.label && <div className="text-base font-medium"><RichTextView html={q.label} className="!text-base" /></div>}
        {q.help && <RichTextView html={q.help} />}
      </div>
    );
    const group = q.required && (q.type === "long_text" || q.type === "multi_choice") ? q.id : undefined;
    return (
      <Q key={q.id} title={<span className="[&>div]:inline-block [&>div]:align-top [&_p]:inline"><RichTextView html={q.label} className="!text-base" /></span>} required={q.required} help={q.help} group={group} missing={missing.has(q.id)}>
        {q.type === "short_text" && <input name={`q_${q.id}`} defaultValue={(a(q.id) as string) ?? ""} required={q.required} placeholder="Your answer" className="input-line w-1/2" />}
        {q.type === "long_text" && <ParagraphAnswer name={`q_${q.id}`} initial={(a(q.id) as string) ?? ""} />}
        {q.type === "number" && <input name={`q_${q.id}`} type="number" step="any" defaultValue={(a(q.id) as number) ?? ""} required={q.required} placeholder="Your answer" className="input-line w-1/3" />}
        {q.type === "yes_no" && (["yes", "no"] as const).map((v) => (
          <label key={v} className="gf-radio capitalize"><input type="radio" name={`q_${q.id}`} value={v} required={q.required} defaultChecked={a(q.id) === (v === "yes")} /> {v}</label>
        ))}
        {q.type === "single_choice" && (q.options ?? []).map((o) => (
          <label key={o} className="gf-radio"><input type="radio" name={`q_${q.id}`} value={o} required={q.required} defaultChecked={a(q.id) === o} /> {o}</label>
        ))}
        {q.type === "multi_choice" && (q.options ?? []).map((o) => (
          <label key={o} className="gf-radio"><input type="checkbox" name={`q_${q.id}`} value={o} defaultChecked={Array.isArray(a(q.id)) && (a(q.id) as string[]).includes(o)} /> {o}</label>
        ))}
      </Q>
    );
  };

  const last = target === SUBMIT;
  return (
    <form ref={formRef} action={action} className="space-y-3"
      onChange={() => { setTarget(targetFrom(current)); if (missing.size) setMissing(new Set(pageMissing(current))); }}
      onSubmit={(e) => {
        // Enter on a middle page means Next, as in Google Forms; the last page checks the
        // answers the browser can't before submitting.
        if (!last) { e.preventDefault(); goNext(); }
        else if (!pageValid(current)) e.preventDefault();
      }}>
      <input type="hidden" name="form_id" value={formId} />
      {current === 0 ? titleCard : (laterTitleCard ?? titleCard)}
      {current === 0 && intro}
      {sections.map((sec, i) => (
        <fieldset key={sec.marker?.id ?? "first"} ref={(el) => { pageRefs.current[i] = el; }} hidden={i !== current} disabled={!history.includes(i)} className="m-0 min-w-0 space-y-3 border-0 p-0">
          {i > 0 && sec.marker && (
            <div className="gf-section-head">
              <div className="gf-section-title">{sec.marker.label || "Untitled section"}</div>
              {sec.marker.help && <div className="px-6 py-4"><RichTextView html={sec.marker.help} /></div>}
            </div>
          )}
          {i === 0 && <>
            {header}
            {events.length > 0 && (
              <Q title={<><Icon name="house" /> Different address just for these rides?</>}
                help="Optional. If you're driving from or need picking up somewhere other than your profile address this time, enter it once here — it applies to every day below where you chose your home address. Your profile isn't changed.">
                <input name="ride_address" placeholder="Street address and city (leave blank to use your home address)" className="input-line w-full" />
              </Q>
            )}
            {askBirthday && (
              <Q title={<><Icon name="party" /> When&apos;s your birthday?</>} required help="Saved to your profile so the team calendar can celebrate you — only the month and day are shown. You won't be asked again.">
                <input name="birthday" type="date" required min="1900-01-01" className="input-line w-1/2" />
              </Q>
            )}
            {askWeight && (
              <Q title={<><Icon name="weight" /> What&apos;s your current weight? (lb)</>} help="Coaches need this to make lineups. Leave as-is if unchanged — saved to your profile.">
                <input name="weight_lb" type="number" step="0.1" min={60} max={450} defaultValue={weightLb ?? ""} placeholder="Your answer" className="input-line w-1/2" />
              </Q>
            )}
          </>}
          {sec.items.map(renderItem)}
        </fieldset>
      ))}

      {state.error && <p className="text-sm" style={{ color: "var(--g-red)" }}>{state.error}</p>}
      {state.warning && <p className="text-sm" style={{ color: "#b06000" }}>{state.warning}</p>}
      {state.saved && <div className="gf-card text-sm"><Icon name="yes" /> {savedMessage ?? "Your response has been recorded. You can resubmit any time before the form closes — the latest one counts."}</div>}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          {paged && history.length > 1 && <button type="button" onClick={goBack} className="gf-nav-btn">Back</button>}
          {last
            ? <button disabled={pending} className="btn-purple">{pending ? "Submitting…" : submittedAt ? "Update response" : "Submit"}</button>
            : <button type="button" onClick={goNext} className="gf-nav-btn">Next</button>}
        </div>
        {submittedAt && !state.saved && <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Last submitted <LocalTime iso={submittedAt} /></span>}
      </div>
    </form>
  );
}
