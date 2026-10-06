"use client";

import { useState } from "react";
import { ATTENDANCE_OPTIONS, toChoice, type AttendanceChoice } from "@/lib/attendance";
import Icon, { type IconName } from "@/components/icon";

const OPTION_ICONS: Partial<Record<AttendanceChoice, IconName>> = { yes_driver: "crown", yes_needs_ride: "hand", maybe: "maybe" };
import type { PickupLocation, Rsvp } from "@/lib/database.types";

/**
 * Attendance + ride question, styled like a Google Forms multiple-choice question.
 * Writes fields `${prefix}choice|seats|pickup|pickup_address|note` for parseAttendance().
 */
export default function AttendanceFields({ prefix, existing, pickups, defaultSeats, required = true, showNote = true }: {
  prefix: string; existing: Rsvp | null; pickups: PickupLocation[]; defaultSeats: number | null; required?: boolean; showNote?: boolean;
}) {
  const [choice, setChoice] = useState<AttendanceChoice | null>(toChoice(existing));
  const [pickup, setPickup] = useState(existing?.pickup_location_id ?? (existing?.pickup_address ? "other" : "home"));
  return (
    <div className="space-y-2">
      <div>
        {ATTENDANCE_OPTIONS.map((o) => (
          <label key={o.value} className="gf-radio">
            <input type="radio" name={`${prefix}choice`} value={o.value} required={required} checked={choice === o.value} onChange={() => setChoice(o.value)} />
            {o.label}{OPTION_ICONS[o.value] && <Icon name={OPTION_ICONS[o.value]!} />}
          </label>
        ))}
      </div>
      {choice === "yes_driver" && (
        <div className="ml-2 mt-3 pl-3 border-l-2 text-sm space-y-1" style={{ borderColor: "var(--g-purple)" }}>
          <div className="font-medium">How many can you drive (excluding you)?</div>
          <input name={`${prefix}seats`} type="number" min={1} max={14} required defaultValue={existing?.seats ?? (defaultSeats ? defaultSeats : 3)} className="input-line w-40" />
          <div className="font-medium pt-2"><Icon name="house" /> Where are you driving from?</div>
          <select name={`${prefix}pickup`} value={pickup === "other" ? "other" : "home"} onChange={(e) => setPickup(e.target.value)} className="input">
            <option value="home">My home address (from my profile)</option>
            <option value="other">Somewhere else this time…</option>
          </select>
          {pickup === "other" && <input name={`${prefix}pickup_address`} defaultValue={existing?.pickup_address ?? ""} placeholder="Street address and city" className="input-line" required />}
        </div>
      )}
      {choice === "yes_needs_ride" && (
        <div className="ml-2 mt-3 pl-3 border-l-2 text-sm space-y-2" style={{ borderColor: "var(--g-purple)" }}>
          <div className="font-medium"><Icon name="house" /> Where should we pick you up?</div>
          <select name={`${prefix}pickup`} value={pickup} onChange={(e) => setPickup(e.target.value)} className="input">
            <option value="home">My home address (from my profile)</option>
            {pickups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="other">Other…</option>
          </select>
          {pickup === "other" && <input name={`${prefix}pickup_address`} defaultValue={existing?.pickup_address ?? ""} placeholder="Address, complex name, or house acronym — just for this ride" className="input-line" required />}
        </div>
      )}
      {showNote && <input name={`${prefix}note`} defaultValue={existing?.note ?? ""} placeholder="Note (optional, e.g. arriving late)" className="input-line mt-3 text-sm" />}
    </div>
  );
}
