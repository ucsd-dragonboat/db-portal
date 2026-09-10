"use client";

import { useActionState, useState } from "react";
import dynamic from "next/dynamic";
import RichTextView from "@/components/rich-text-view";

// Lazy: tiptap only downloads when the form actually has a paragraph question.
const RichEditor = dynamic(() => import("@/components/rich-editor"), {
  ssr: false,
  loading: () => <div className="input-line w-full text-sm" style={{ color: "var(--g-grey-600)" }}>Loading editor…</div>,
});
import { submitForm, type SubmitState } from "./actions";
import AttendanceFields from "@/components/attendance-fields";
import LocalTime from "@/components/local-time";
import type { Event, FormQuestion, PickupLocation, Rsvp } from "@/lib/database.types";
import Icon from "@/components/icon";

const Q = ({ title, required, help, meta, children }: { title: React.ReactNode; required?: boolean; help?: string; meta?: React.ReactNode; children: React.ReactNode }) => (
  <div className="gf-card space-y-3">
    <div className="text-base font-normal">{title}{required && <span className="gf-required"> *</span>}</div>
    {meta && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>{meta}</p>}
    {help && <RichTextView html={help} className="!text-xs" />}
    {children}
  </div>
);

function ParagraphAnswer({ name, initial }: { name: string; initial: string }) {
  const [v, setV] = useState(initial);
  return (<><input type="hidden" name={name} value={v} /><RichEditor value={v} onChange={setV} minRows={3} placeholder="Your answer" /></>);
}

export default function FillForm({ formId, events, rsvpBy, questions, existingAnswers, pickups, defaultSeats, weightLb, askWeight, submittedAt, submitAction = submitForm, header }: {
  formId: string; events: { prompt: string | null; event: Event }[]; rsvpBy: Record<string, Rsvp>; questions: FormQuestion[];
  existingAnswers: Record<string, unknown> | null; pickups: PickupLocation[]; defaultSeats: number | null; weightLb: number | null; askWeight: boolean; submittedAt: string | null;
  /** Public (shared-link) forms submit through a different action and show an email/name block first. */
  submitAction?: (state: SubmitState, fd: FormData) => Promise<SubmitState>; header?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitAction, {});
  const a = (id: string) => existingAnswers?.[id];
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="form_id" value={formId} />
      {header}

      {askWeight && (
        <Q title={<><Icon name="weight" /> What&apos;s your current weight? (lb)</>} help="Coaches need this to make lineups. Leave as-is if unchanged — saved to your profile.">
          <input name="weight_lb" type="number" step="0.1" min={60} max={450} defaultValue={weightLb ?? ""} placeholder="Your answer" className="input-line w-1/2" />
        </Q>
      )}

      {events.map(({ event, prompt }, i) => (
        <Q key={event.id} required title={prompt || <><Icon name={i % 2 ? "moon" : "sun"} /> Will you be attending {event.title}?</>}
          meta={<><LocalTime iso={event.starts_at} />{event.location_name && <> · <Icon name="pin" /> {event.location_name}</>}</>} help={event.notes ?? undefined}>
          <AttendanceFields prefix={`ev_${event.id}_`} existing={rsvpBy[event.id] ?? null} pickups={pickups} defaultSeats={defaultSeats} />
        </Q>
      ))}

      {questions.map((q) => q.type === "info" ? (
        // Read-only info card — admin-authored rich text, nothing to answer.
        <div key={q.id} className="gf-card space-y-2">
          {q.label && <div className="text-base font-medium">{q.label}</div>}
          {q.help && <RichTextView html={q.help} />}
        </div>
      ) : (
        <Q key={q.id} title={q.label} required={q.required} help={q.help}>
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
      ))}

      {state.error && <p className="text-sm" style={{ color: "var(--g-red)" }}>{state.error}</p>}
      {state.saved && <div className="gf-card text-sm"><Icon name="yes" /> Your response has been recorded. You can resubmit any time before the form closes — the latest one counts.</div>}
      <div className="flex items-center justify-between pt-1">
        <button disabled={pending} className="btn-purple">{pending ? "Submitting…" : submittedAt ? "Update response" : "Submit"}</button>
        {submittedAt && !state.saved && <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Last submitted <LocalTime iso={submittedAt} /></span>}
      </div>
    </form>
  );
}
