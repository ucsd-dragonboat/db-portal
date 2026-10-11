"use client";

import { useState } from "react";
import { ATTENDANCE_OPTIONS, toChoice, type AttendanceChoice } from "@/lib/attendance";
import Icon, { type IconName } from "@/components/icon";
import Dialog from "@/components/dialog";

const OPTION_ICONS: Partial<Record<AttendanceChoice, IconName>> = { yes_driver: "crown", yes_needs_ride: "hand", maybe: "maybe" };
import type { PickupLocation, Rsvp } from "@/lib/database.types";

/**
 * Attendance + ride question, styled like a Google Forms multiple-choice question.
 * Writes fields `${prefix}choice|seats|campus|pickup|pickup_address|save_default|note` for parseAttendance().
 * Riders pick On campus (a pickup spot, from a dialog) or Off campus (home or a typed
 * address); `defaultPickupId` (the member's saved default spot) preselects On campus.
 */
export default function AttendanceFields({ prefix, existing, pickups, defaultSeats, defaultPickupId = null, required = true, showNote = true }: {
  prefix: string; existing: Rsvp | null; pickups: PickupLocation[]; defaultSeats: number | null; defaultPickupId?: string | null; required?: boolean; showNote?: boolean;
}) {
  const [choice, setChoice] = useState<AttendanceChoice | null>(toChoice(existing));
  const savedSpot = defaultPickupId && pickups.some((p) => p.id === defaultPickupId) ? defaultPickupId : null;
  const [pickup, setPickup] = useState(existing ? existing.pickup_location_id ?? (existing.pickup_address ? "other" : "home") : savedSpot ?? "home");
  // Only a spot that's still offered counts — a since-retired one must be picked again.
  const isSpot = pickups.some((p) => p.id === pickup);
  const [campus, setCampus] = useState<"on" | "off">(isSpot ? "on" : "off");
  const [picking, setPicking] = useState(false);
  const spotName = pickups.find((p) => p.id === pickup)?.name;
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
          <input type="hidden" name={`${prefix}campus`} value={campus} />
          <div className="flex gap-4">
            {pickups.length > 0 && (
              <label className="gf-radio !py-1">
                <input type="radio" checked={campus === "on"} onChange={() => { setCampus("on"); if (!isSpot) { setPickup(""); setPicking(true); } }} /> On campus
              </label>
            )}
            <label className="gf-radio !py-1">
              <input type="radio" checked={campus === "off"} onChange={() => { setCampus("off"); if (pickup !== "other") setPickup("home"); }} /> Off campus
            </label>
          </div>
          {campus === "on" ? (
            <div className="flex items-center gap-2">
              <input type="hidden" name={`${prefix}pickup`} value={pickup} />
              {/* Empty until a spot is picked, so the browser blocks submitting without one. */}
              <input value={isSpot ? pickup : ""} onChange={() => {}} required={required} tabIndex={-1} aria-hidden className="sr-only" />
              <span>{spotName ? <b>{spotName}</b> : <span style={{ color: "var(--g-grey-600)" }}>No pickup spot chosen</span>}</span>
              <button type="button" onClick={() => setPicking(true)} className="btn-text text-sm" style={{ color: "var(--g-blue)" }}>{spotName ? "Change" : "Choose spot"}</button>
            </div>
          ) : (
            <>
              <select name={`${prefix}pickup`} value={pickup === "other" ? "other" : "home"} onChange={(e) => setPickup(e.target.value)} className="input">
                <option value="home">My home address (from my profile)</option>
                <option value="other">Somewhere else…</option>
              </select>
              {pickup === "other" && <input name={`${prefix}pickup_address`} defaultValue={existing?.pickup_address ?? ""} placeholder="Street address and city" className="input-line" required />}
            </>
          )}
          {(campus === "on" || pickup === "other") && (
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--g-grey-600)" }}>
              <input type="checkbox" name={`${prefix}save_default`} />
              {campus === "on" ? "Save as my default pickup spot (preselected on future forms)" : "Save this as my home address on my profile"}
            </label>
          )}
          {picking && (
            <Dialog title="Choose your pickup spot" onClose={() => { setPicking(false); if (!isSpot) { setCampus("off"); setPickup("home"); } }}>
              <div className="grid grid-cols-2 gap-2">
                {pickups.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setPickup(p.id); setCampus("on"); setPicking(false); }}
                    className="rounded-md border px-3 py-2 text-left text-sm hover:bg-[var(--g-blue-tint)]"
                    style={{ borderColor: p.id === pickup ? "var(--g-blue)" : "var(--g-grey-300)", background: p.id === pickup ? "var(--g-blue-tint)" : undefined }}>
                    <Icon name="pin" /> {p.name}
                  </button>
                ))}
              </div>
            </Dialog>
          )}
        </div>
      )}
      {showNote && <input name={`${prefix}note`} defaultValue={existing?.note ?? ""} placeholder="Note (optional, e.g. arriving late)" className="input-line mt-3 text-sm" />}
    </div>
  );
}
