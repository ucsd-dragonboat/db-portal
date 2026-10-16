"use client";

import { useActionState } from "react";
import { syncTeamCalendarAction } from "../actions";

/** Runs the team calendar sync right away instead of waiting for the 10-minute cron. */
export default function SyncNowButton() {
  const [state, action, pending] = useActionState(syncTeamCalendarAction, {});
  return (
    <form action={action} className="text-right">
      <button disabled={pending} className="text-xs text-slate-600 underline whitespace-nowrap disabled:no-underline">{pending ? "Syncing…" : "Sync now"}</button>
      {!pending && state.summary && <p className="text-xs text-green-700">{state.summary}</p>}
      {!pending && state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
