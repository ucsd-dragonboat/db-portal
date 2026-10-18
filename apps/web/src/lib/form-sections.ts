// Google Forms-style sections. A section break is a "section" marker in the form's
// questions list (like the "day" markers). When a form has sections, questions[0] is a
// leading marker that stands for section 1 (whose title and description are the form's
// own); it only carries section 1's "After section 1" setting. Shared by the editor,
// the fill page and the server, so all three agree on where Next goes.

import type { FormQuestion } from "@/lib/database.types";

/** Navigation targets: continue to the next section, submit, or a section marker's id. */
export const NEXT = "next";
export const SUBMIT = "submit";

export type Section<T> = { marker: FormQuestion | null; items: T[] };

const isMarker = (q: FormQuestion | null | undefined): q is FormQuestion => q?.type === "section";

/** Splits an ordered list at section markers. A marker in first place is section 1's
 * leading marker; every other marker starts a new section. No markers → one section. */
export function splitSections<T>(items: T[], questionOf: (it: T) => FormQuestion | null): Section<T>[] {
  const out: Section<T>[] = [{ marker: null, items: [] }];
  items.forEach((it, i) => {
    const q = questionOf(it);
    if (!isMarker(q)) out[out.length - 1].items.push(it);
    else if (i === 0) out[0].marker = q;
    else out.push({ marker: q, items: [] });
  });
  return out;
}

/** Where a target string points from section i: a section index, or SUBMIT. Unknown
 * section ids (a deleted section) fall back to the next section. */
function resolve<T>(target: string | undefined, i: number, sections: Section<T>[]): number | typeof SUBMIT {
  if (target === SUBMIT) return SUBMIT;
  if (target && target !== NEXT) {
    const j = sections.findIndex((s) => s.marker?.id === target);
    if (j >= 0) return j;
  }
  return i + 1 < sections.length ? i + 1 : SUBMIT;
}

/** Where Next goes from section i. Like Google Forms: the last answered "go to section
 * based on answer" question in the section wins; otherwise the section's own "After
 * section" setting (ignored on the last section, which submits). */
export function nextTarget<T>(sections: Section<T>[], i: number, questionOf: (it: T) => FormQuestion | null, valueOf: (qid: string) => unknown): number | typeof SUBMIT {
  let chosen: string | undefined;
  for (const it of sections[i].items) {
    const q = questionOf(it);
    if (!q?.branch || (q.type !== "single_choice" && q.type !== "yes_no")) continue;
    const v = valueOf(q.id);
    if (typeof v === "string" && q.branch[v]) chosen = q.branch[v];
  }
  if (chosen) return resolve(chosen, i, sections);
  if (i === sections.length - 1) return SUBMIT;
  return resolve(sections[i].marker?.after, i, sections);
}

/** The sections a respondent passes through with these answers, from section 1 to
 * Submit. `loop` means the answers lead back to a section already visited, so the
 * form can never be submitted that way. */
export function sectionPath<T>(sections: Section<T>[], questionOf: (it: T) => FormQuestion | null, valueOf: (qid: string) => unknown): { path: number[]; loop: boolean } {
  const path = [0];
  for (;;) {
    const t = nextTarget(sections, path[path.length - 1], questionOf, valueOf);
    if (t === SUBMIT) return { path, loop: false };
    if (path.includes(t)) return { path, loop: true };
    path.push(t);
  }
}

/** Server side: which questions and attendance days are on this respondent's path.
 * Days without a marker (older forms) belong to section 1; hidden days aren't asked. */
export function answeredParts(questions: FormQuestion[], valueOf: (qid: string) => unknown) {
  const sections = splitSections(questions, (q) => q);
  const { path, loop } = sectionPath(sections, (q) => q, valueOf);
  const onPath = new Set(path.flatMap((i) => sections[i].items));
  const skippedDays = new Set(questions.filter((q) => q.type === "day" && q.event_id && !q.hidden && !onPath.has(q)).map((q) => q.event_id!));
  const hiddenDays = new Set(questions.filter((q) => q.type === "day" && q.hidden).map((q) => q.event_id));
  return {
    loop,
    isAnswered: (q: FormQuestion) => onPath.has(q),
    dayAnswered: (eventId: string) => !skippedDays.has(eventId) && !hiddenDays.has(eventId),
    /** The day's question is hidden: it isn't asked, and earlier answers are left alone. */
    dayHidden: (eventId: string) => hiddenDays.has(eventId),
  };
}
