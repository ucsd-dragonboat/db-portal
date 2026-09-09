"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/icon";
import Dialog from "@/components/dialog";
import CopyButton from "@/components/copy-button";

/** Canvas-style "Calendar Feed" dialog: the subscription URL, right where you clicked. */
export default function FeedDialog({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const url = token && typeof window !== "undefined" ? `${location.origin}/api/calendar/${token}` : "";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-text -ml-3 text-sm" style={{ color: "var(--g-blue)" }}>
        <Icon name="calendar" /> Calendar feed
      </button>
      {open && (
        <Dialog title="Calendar feed" onClose={() => setOpen(false)}>
          {token ? (
            <>
              <p className="mb-3 text-sm" style={{ color: "var(--g-grey-600)" }}>
                Copy the link below and paste it into any calendar app that takes iCal feeds
                (Google Calendar, Apple Calendar, Outlook…). It updates automatically as events change.
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={url} onFocus={(e) => e.target.select()} className="input flex-1 text-xs" />
                <CopyButton text={() => url} />
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
        </Dialog>
      )}
    </>
  );
}
