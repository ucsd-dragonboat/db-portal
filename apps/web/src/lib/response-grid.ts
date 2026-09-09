import { toChoice, ATTENDANCE_OPTIONS } from "@/lib/attendance";
import { htmlToText } from "@/lib/html";
import { fmtDateTime } from "@/lib/format";
import type { Form, FormQuestion, FormResponse, Profile, Rsvp } from "@/lib/database.types";

const choiceLabel = Object.fromEntries(ATTENDANCE_OPTIONS.map((o) => [o.value, o.label.replace(/ [^\w\s]+$/u, "")]));

export type GridEvent = { id: string; title: string; starts_at: string };

/** One row per responded member — shared by the admin Responses page (table + CSV) and the Sheets sync. */
export function buildResponseGrid(input: {
  form: Form;
  events: GridEvent[];
  profiles: Profile[];
  responses: FormResponse[];
  rsvps: Rsvp[];
  pickups: { id: string; name: string }[];
}) {
  const { form, events, responses, rsvps, pickups } = input;
  const rsvpBy = new Map<string, Rsvp>();
  for (const r of rsvps) rsvpBy.set(`${r.event_id}:${r.user_id}`, r);
  const pickupName = new Map(pickups.map((p) => [p.id, p.name]));
  const questions = ((form.questions as unknown as FormQuestion[]) ?? []);
  const profiles = [...input.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const respBy = new Map(responses.map((r) => [r.user_id, r]));
  const responded = profiles.filter((p) => respBy.has(p.id));
  const missing = profiles.filter((p) => !respBy.has(p.id));

  const rideCell = (r: Rsvp | undefined) => {
    if (!r) return "";
    const c = toChoice(r); let s = choiceLabel[c ?? ""] ?? "";
    if (r.ride === "driver") s += ` (${r.seats ?? "?"} seats)`;
    if (r.ride === "needs_ride") s += ` @ ${r.pickup_location_id ? pickupName.get(r.pickup_location_id) ?? "?" : r.pickup_address ?? "home"}`;
    if (r.note) s += ` — ${r.note}`;
    return s;
  };
  const ansCell = (uid: string, q: FormQuestion) => {
    const a = (respBy.get(uid)?.answers as Record<string, unknown> | null)?.[q.id];
    if (a == null || a === "") return "";
    if (Array.isArray(a)) return a.join(", ");
    if (typeof a === "boolean") return a ? "Yes" : "No";
    return htmlToText(String(a));
  };

  const dueAt = form.due_at ? new Date(form.due_at) : null;
  const isLate = (uid: string) => {
    const r = respBy.get(uid);
    return !!dueAt && !!r && new Date(r.first_submitted_at ?? r.submitted_at) > dueAt;
  };
  const header = ["Name", "Email", "Weight (lb)", "Phone", ...events.map((e) => e.title), ...questions.map((q) => q.label), "Submitted", "On time"];
  const rows: (string | number)[][] = responded.map((p) => [p.full_name, p.email, p.weight_lb ?? "", p.phone ?? "", ...events.map((e) => rideCell(rsvpBy.get(`${e.id}:${p.id}`))), ...questions.map((q) => ansCell(p.id, q)), fmtDateTime(respBy.get(p.id)!.submitted_at), dueAt ? (isLate(p.id) ? "Late" : "On time") : ""]);
  const lateFlags = responded.map((p) => isLate(p.id));

  return { questions, profiles, responded, missing, header, rows, lateFlags };
}
