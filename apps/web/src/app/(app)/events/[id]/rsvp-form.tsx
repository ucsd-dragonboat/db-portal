"use client";

import { useActionState } from "react";
import Icon from "@/components/icon";
import { submitRsvp, type RsvpState } from "./actions";
import AttendanceFields from "@/components/attendance-fields";
import type { PickupLocation, Rsvp } from "@/lib/database.types";

export default function RsvpForm({ eventId, existing, defaultSeats, pickups }: { eventId: string; existing: Rsvp | null; defaultSeats: number | null; pickups: PickupLocation[] }) {
  const [state, action, pending] = useActionState<RsvpState, FormData>(submitRsvp, {});
  return (
    <form action={action} className="gf-card space-y-4" style={{ borderTop: "6px solid var(--g-purple)" }}>
      <input type="hidden" name="event_id" value={eventId} />
      <div className="text-base"><Icon name="sun" /> Will you be attending? <span className="gf-required">*</span></div>
      <AttendanceFields prefix="a_" existing={existing} pickups={pickups} defaultSeats={defaultSeats} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.saved && <p className="text-sm text-green-700">Saved!</p>}
      {state.warning && <p className="text-sm" style={{ color: "#b06000" }}>{state.warning}</p>}
      <button disabled={pending} className="btn-purple">{existing ? "Update RSVP" : "Submit RSVP"}</button>
    </form>
  );
}
