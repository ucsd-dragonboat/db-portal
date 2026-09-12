"use client";

import { useActionState } from "react";
import { connectTeamCalendarAction } from "../actions";

/** "Create team calendar" with visible errors (API disabled / missing scope) instead of a crash page. */
export default function TeamCalendarForm() {
  const [state, action, pending] = useActionState(connectTeamCalendarAction, null);
  return (
    <div className="text-right">
      <form action={action}>
        <button disabled={pending} className="btn-secondary whitespace-nowrap">{pending ? "Creating…" : "Create team calendar"}</button>
      </form>
      {state?.error && <p className="mt-1 max-w-xs text-xs" style={{ color: "var(--g-red)" }}>{state.error}</p>}
    </div>
  );
}
