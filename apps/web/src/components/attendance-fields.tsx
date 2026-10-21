"use client";

import { useState } from "react";
import { ATTENDANCE_OPTIONS, toChoice, type AttendanceChoice } from "@/lib/attendance";
import Icon, { type IconName } from "@/components/icon";
import Dialog from "@/components/dialog";

const OPTION_ICONS: Partial<Record<AttendanceChoice, IconName>> = { yes_driver: "crown", yes_needs_ride: "hand", maybe: "maybe" };
import type { Rsvp } from "@/lib/database.types";
import type { CampusSpot } from "@/lib/campus-spots";

/**
 * Attendance + ride question, styled like a Google Forms multiple-choice question.
 * Writes fields `${prefix}choice|seats|campus|pickup|pickup_address|save_default|note` for parseAttendance().
 * Riders pick On campus (a pickup spot, from a dialog) or Off campus (home or a typed
 * address); `defaultPickupId` (the member's saved default spot) preselects On campus.
 * `pickups` are the on-campus spots (pickup + saved locations, lib/campus-spots.ts);
 * `fixedSpot` is the form creator's chosen spot, which replaces the rider's choice.
 */
export default function AttendanceFields({ prefix, existing, pickups, defaultSeats, defaultPickupId = null, fixedSpot = null, required = true, showNote = true }: {
  prefix: string; existing: Rsvp | null; pickups: CampusSpot[]; defaultSeats: number | null; defaultPickupId?: string | null;
  fixedSpot?: string | null; required?: boolean; showNote?: boolean;
}) {
  const [choice, setChoice] = useState<AttendanceChoice | null>(toChoice(existing));
  const fixed = fixedSpot && pickups.some((p) => p.id === fixedSpot) ? fixedSpot : null;
  const savedSpot = defaultPickupId && pickups.some((p) => p.id === defaultPickupId) ? (fixed ?? defaultPickupId) : null;
  // A saved-location spot is stored on the RSVP as its name, so match it back by name.
  const existingSpot = existing && (existing.pickup_location_id
    ?? (existing.pickup_address ? pickups.find((p) => p.id.startsWith("saved:") && p.name === existing.pickup_address)?.id : undefined));
  const [pickup, setPickup] = useState(existing
    ? (existingSpot ? fixed ?? existingSpot : existing.pickup_address ? "other" : "home")
    : savedSpot ?? "home");
  // Only a spot that's still offered counts — a since-retired one must be picked again.
  const isSpot = pickups.some((p) => p.id === pickup);
  const [campus, setCampus] = useState<"on" | "off">(isSpot ? "on" : "off");
  const [picking, setPicking] = useState(false);
  const spotName = pickups.find((p) => p.id === pickup)?.name;
  const chooseOnCampus = () => { setCampus("on"); if (fixed) setPickup(fixed); else if (!isSpot) { setPickup(""); setPicking(true); } };
  const chooseOffCampus = () => { setCampus("off"); if (pickup !== "other") setPickup("home"); };
  // "I need a ride" is two answers, on campus and off campus, so nobody lands on the
  // off-campus default by accident. Both still post yes_needs_ride; the hidden `campus`
  // field below says which. On campus only exists when there are campus spots.
  type Option = { key: string; value: AttendanceChoice; label: string; checked: boolean; select: () => void };
  const options = ATTENDANCE_OPTIONS.flatMap((o): Option[] => o.value !== "yes_needs_ride"
    ? [{ key: o.value, value: o.value, label: o.label, checked: choice === o.value, select: () => setChoice(o.value) }]
    : [
        ...(pickups.length ? [{ key: "ride_on", value: o.value, label: "Yes, and I need a ride on campus", checked: choice === o.value && campus === "on", select: () => { setChoice(o.value); chooseOnCampus(); } }] : []),
        { key: "ride_off", value: o.value, label: "Yes, and I need a ride off campus", checked: choice === o.value && campus === "off", select: () => { setChoice(o.value); chooseOffCampus(); } },
      ]);
  return (
    <div className="space-y-2">
      <div>
        {options.map((o) => (
          <label key={o.key} className="gf-radio">
            <input type="radio" name={`${prefix}choice`} value={o.value} required={required} checked={o.checked} onChange={o.select} />
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
          <div className="font-medium"><Icon name={campus === "on" ? "pin" : "house"} /> {campus === "on" ? "Which spot on campus?" : "Where should we pick you up?"}</div>
          <input type="hidden" name={`${prefix}campus`} value={campus} />
          {campus === "on" ? (
            <div className="flex items-center gap-2">
              <input type="hidden" name={`${prefix}pickup`} value={pickup} />
              {/* Empty until a spot is picked, so the browser blocks submitting without one. */}
              <input value={isSpot ? pickup : ""} onChange={() => {}} required={required} tabIndex={-1} aria-hidden className="sr-only" />
              <span>{fixed && <>Pickup at </>}{spotName ? <b>{spotName}</b> : <span style={{ color: "var(--g-grey-600)" }}>No pickup spot chosen</span>}</span>
              {!fixed && <button type="button" onClick={() => setPicking(true)} className="btn-text text-sm" style={{ color: "var(--g-blue)" }}>{spotName ? "Change" : "Choose spot"}</button>}
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
          {((campus === "on" && !fixed) || (campus === "off" && pickup === "other")) && (
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--g-grey-600)" }}>
              <input type="checkbox" name={`${prefix}save_default`} />
              {campus === "on" ? "Save as my default pickup spot (preselected on future forms)" : "Save this as my home address on my profile"}
            </label>
          )}
          {picking && (
            // Closing without a spot keeps "on campus" (it was asked for); the hidden required
            // input then blocks submitting until a spot is chosen.
            <Dialog title="Choose your pickup spot" onClose={() => setPicking(false)}>
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
