"use client";

import { useState } from "react";
import Icon from "@/components/icon";
import { resetCalendarToken } from "./actions";

/** Personal iCal subscription link — Google Calendar keeps itself up to date from it. */
export default function CalendarFeed({ token }: { token: string }) {
  const [copied, setCopied] = useState<"https" | "webcal" | null>(null);
  const path = `/api/calendar/${token}`;
  const copy = (kind: "https" | "webcal") => {
    const url = kind === "https" ? `${location.origin}${path}` : `webcal://${location.host}${path}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(kind); setTimeout(() => setCopied(null), 2500); });
  };
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
        <button type="button" onClick={() => copy("https")} className="btn-secondary whitespace-nowrap">
          {copied === "https" ? <><Icon name="check" /> Copied</> : <><Icon name="link" /> Copy link</>}
        </button>
        <button type="button" onClick={() => copy("webcal")} className="btn-text whitespace-nowrap" title="webcal:// opens directly in Apple Calendar and some apps">
          {copied === "webcal" ? "Copied" : "Copy webcal://"}
        </button>
      </div>
      <form
        action={resetCalendarToken}
        onSubmit={(e) => { if (!confirm("Reset your calendar link? Any calendar app subscribed with the old link will stop updating.")) e.preventDefault(); }}
      >
        <button className="text-xs text-slate-500 underline">reset link</button>
      </form>
    </div>
  );
}
