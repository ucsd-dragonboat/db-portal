import type { RideChoice, Rsvp } from "@/lib/database.types";
import { fmtMonthDay, fmtWeekday } from "@/lib/format";

/** "practice" / "race" / "social" — the word that says what kind of day this is.
 * "other" contributes nothing, because "attending Saturday other (10/10)?" is nonsense. */
const kindWord = (kind: string) => (kind === "other" ? "" : ` ${kind}`);

/** The attendance question for one linked day. This is both what the member reads on
 * the form AND the Google Sheets column header for that day — deliberately the same
 * string, so attendance tracking that matches on the header can't drift away from what
 * was actually asked. A custom form_events.prompt always wins.
 *
 * The day name and the kind sit next to each other on purpose ("Saturday practice"),
 * with the date after in parentheses: that's what lets a pattern find the day and the
 * kind as neighbours instead of having a date wedged between them. */
export const attendancePrompt = (prompt: string | null | undefined, ev: { starts_at: string; kind: string }) =>
  prompt?.trim() || `Will you be attending ${fmtWeekday(ev.starts_at)}${kindWord(ev.kind)} (${fmtMonthDay(ev.starts_at)})?`;

/** The single "Will you be attending?" choice, combining status + ride like the old Google Forms. */
export type AttendanceChoice = "yes_driver" | "yes_self" | "yes_needs_ride" | "maybe" | "no";

export const ATTENDANCE_OPTIONS: { value: AttendanceChoice; label: string }[] = [
  { value: "yes_driver", label: "Yes, and I can drive others" },
  { value: "yes_self", label: "Yes, and I'll get there myself (not driving others) 🫥" },
  { value: "yes_needs_ride", label: "Yes, and I need a ride" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No 🤡" },
];

export function toChoice(r: Pick<Rsvp, "status" | "ride"> | null | undefined): AttendanceChoice | null {
  if (!r) return null;
  if (r.status === "no") return "no";
  if (r.status === "maybe") return "maybe";
  if (r.ride === "driver") return "yes_driver";
  if (r.ride === "needs_ride") return "yes_needs_ride";
  return "yes_self";
}

export type AttendanceValues = {
  status: Rsvp["status"]; ride: RideChoice; seats: number | null;
  pickup_location_id: string | null; pickup_address: string | null; note: string | null;
};

/** Parse fields written by <AttendanceFields prefix=…>. Returns null if no choice was made. */
export function parseAttendance(fd: FormData, prefix: string): AttendanceValues | null {
  const choice = fd.get(`${prefix}choice`) as AttendanceChoice | null;
  if (!choice) return null;
  const status: Rsvp["status"] = choice === "no" ? "no" : choice === "maybe" ? "maybe" : "yes";
  const ride: RideChoice = choice === "yes_driver" ? "driver" : choice === "yes_needs_ride" ? "needs_ride" : choice === "yes_self" ? "self" : "none";
  const seatsRaw = fd.get(`${prefix}seats`);
  const pickup = String(fd.get(`${prefix}pickup`) ?? "");
  const custom = String(fd.get(`${prefix}pickup_address`) ?? "").trim();
  return {
    status, ride,
    seats: ride === "driver" && seatsRaw ? Number(seatsRaw) : null,
    pickup_location_id: ride === "needs_ride" && pickup && pickup !== "home" && pickup !== "other" ? pickup : null,
    pickup_address: ride === "needs_ride" && pickup === "other" && custom ? custom : null,
    note: String(fd.get(`${prefix}note`) ?? "").trim() || null,
  };
}
