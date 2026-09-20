"use client";

import { useActionState, useState } from "react";
import { connectTeamCalendarAction } from "../actions";
import type { WritableCalendar } from "@/lib/google-calendar";

/** Connect the team calendar: either make a new one, or feed an existing calendar
 * in the admin's Google account. Errors (API disabled / missing scope) show inline
 * instead of crashing to an error page. */
export default function TeamCalendarForm({ calendars }: { calendars: WritableCalendar[] }) {
  const [state, action, pending] = useActionState(connectTeamCalendarAction, null);
  const [choice, setChoice] = useState("");
  return (
    <div className="max-w-xs text-right">
      <form action={action} className="space-y-2">
        {calendars.length > 0 && (
          <select name="calendar_id" value={choice} onChange={(e) => setChoice(e.target.value)} className="input py-1 text-sm">
            <option value="">Create a new calendar</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>{c.primary ? `${c.summary} (your main calendar)` : c.summary}</option>
            ))}
          </select>
        )}
        <button disabled={pending} className="btn-secondary whitespace-nowrap">
          {pending ? (choice ? "Linking…" : "Creating…") : choice ? "Use this calendar" : "Create team calendar"}
        </button>
      </form>
      {choice && (
        <p className="mt-1 text-xs" style={{ color: "var(--g-grey-600)" }}>
          Events already on it stay put and won’t be imported. Deleting an event in the portal does delete it from this calendar.
        </p>
      )}
      {state?.error && <p className="mt-1 text-xs" style={{ color: "var(--g-red)" }}>{state.error}</p>}
    </div>
  );
}
