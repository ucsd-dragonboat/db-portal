"use client";

import Icon from "@/components/icon";
import CopyButton from "@/components/copy-button";
import ConfirmForm from "@/components/confirm-form";
import { resetCalendarToken } from "./actions";

/** Personal iCal subscription link — Google Calendar keeps itself up to date from it. */
export default function CalendarFeed({ token }: { token: string }) {
  const path = `/api/calendar/${token}`;
  return (
    <div id="calendar-feed" className="card space-y-3 mt-4">
      <h2 className="font-semibold"><Icon name="calendar" /> Calendar feed</h2>
      <p className="text-sm text-slate-500">
        Subscribe to the team schedule from your own calendar app — it stays up to date automatically.
        In Google Calendar: <b>Settings → Add calendar → From URL</b>, then paste your link. Google refreshes
        subscribed calendars every few hours.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-xs" style={{ background: "var(--g-grey-100)" }}>…{path}</code>
        <CopyButton text={() => `${location.origin}${path}`} className="btn-secondary whitespace-nowrap"
          label={<><Icon name="link" /> Copy link</>} />
        <CopyButton text={() => `webcal://${location.host}${path}`} className="btn-text whitespace-nowrap"
          label="Copy webcal://" copiedLabel="Copied" title="webcal:// opens directly in Apple Calendar and some apps" />
      </div>
      <ConfirmForm action={resetCalendarToken} message="Reset your calendar link? Any calendar app subscribed with the old link will stop updating.">
        <button className="text-xs text-slate-500 underline">reset link</button>
      </ConfirmForm>
    </div>
  );
}
