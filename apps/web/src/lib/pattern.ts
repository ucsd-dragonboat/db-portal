/**
 * Admin-written regexes for form questions — the one place that understands them, so
 * the editor's preview and the submit-time check can never disagree about what a
 * pattern means.
 *
 * Patterns are accepted the way you'd write one in JavaScript, delimiters and flags
 * included (`/attending.\b(sat(urday)?)\b.practice/is`), or as a bare pattern with
 * neither. Matching is unanchored — a pattern finds its text anywhere in the value, so
 * use ^…$ when the whole value has to match.
 */

/** Longest pattern we'll accept. */
const MAX_SOURCE = 500;
/** Longest value we'll match against. Catastrophic backtracking costs time in
 * proportion to the input, and nothing validated here is a document. */
const MAX_VALUE = 4000;
/** g and y are refused on purpose: both make .test() stateful through lastIndex, so one
 * pattern would alternate between passing and failing on identical input. */
const ALLOWED_FLAGS = "imsu";

type Parsed = { ok: true; re: RegExp } | { ok: false; why: string };

/** null when there's no pattern at all — which is never an error, just no rule. */
function parse(input: string | null | undefined): Parsed | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (s.length > MAX_SOURCE) return { ok: false, why: `Too long — keep it under ${MAX_SOURCE} characters.` };

  let source = s;
  let flags = "";
  if (s.startsWith("/")) {
    const end = s.lastIndexOf("/");
    if (end === 0) return { ok: false, why: "Missing the closing /." };
    source = s.slice(1, end);
    flags = s.slice(end + 1);
    const bad = [...new Set(flags)].filter((f) => !ALLOWED_FLAGS.includes(f));
    if (bad.includes("g") || bad.includes("y")) return { ok: false, why: "The g and y flags make matching unreliable here — leave them off." };
    if (bad.length) return { ok: false, why: `Unknown flag “${bad.join("")}”. Allowed: ${ALLOWED_FLAGS.split("").join(", ")}.` };
  }
  if (!source) return { ok: false, why: "The pattern is empty." };

  try {
    return { ok: true, re: new RegExp(source, flags) };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message.replace(/^Invalid regular expression:?\s*/i, "") : "Not a valid pattern." };
  }
}

/** The compiled pattern, or null if there isn't one or it doesn't compile. */
export function compilePattern(input: string | null | undefined): RegExp | null {
  const p = parse(input);
  return p?.ok ? p.re : null;
}

/** Why this pattern won't work, for the editor to show. null when it's fine or absent. */
export function patternError(input: string | null | undefined): string | null {
  const p = parse(input);
  return p && !p.ok ? p.why : null;
}

/** Does `value` satisfy the rule? True when there is no rule — and also when the rule
 * is broken, because a coach's typo in a pattern must not lock members out of a form.
 * The editor is where a bad pattern gets reported. */
export function testPattern(pattern: string | null | undefined, value: string): boolean {
  const re = compilePattern(pattern);
  return re ? re.test(value.slice(0, MAX_VALUE)) : true;
}
