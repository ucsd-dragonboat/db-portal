"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/icon";

/** Canvas-style "Calendar Feed" dialog: the subscription URL, right where you clicked. */
export default function FeedDialog({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = token && typeof window !== "undefined" ? `${location.origin}/api/calendar/${token}` : "";
  const copy = () => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-text -ml-3 text-sm" style={{ color: "var(--g-blue)" }}>
        <Icon name="calendar" /> Calendar feed
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-24" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">Calendar feed</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn-text"><Icon name="x" /></button>
            </div>
            {token ? (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--g-grey-600)" }}>
                  Copy the link below and paste it into any calendar app that takes iCal feeds
                  (Google Calendar, Apple Calendar, Outlook…). It updates automatically as events change.
                </p>
                <div className="flex items-center gap-2">
                  <input readOnly value={url} onFocus={(e) => e.target.select()} className="input flex-1 text-xs" />
                  <button type="button" onClick={copy} className="btn-primary whitespace-nowrap">
                    {copied ? <><Icon name="check" /> Copied</> : "Copy"}
                  </button>
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--g-grey-600)" }}>
                  Google Calendar: <b>Settings → Add calendar → From URL</b>. This link is personal —
                  you can reset it any time from <Link href="/profile#calendar-feed" className="underline" style={{ color: "var(--g-blue)" }}>your profile</Link>.
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
                The calendar feed isn’t available yet — visit <Link href="/profile#calendar-feed" className="underline" style={{ color: "var(--g-blue)" }}>your profile</Link> to set it up.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
