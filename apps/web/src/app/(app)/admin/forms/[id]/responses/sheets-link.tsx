"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Icon from "@/components/icon";
import { linkSheet, unlinkSheet, type LinkState } from "./actions";

const SheetsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="inline-block align-[-3px]">
    <rect x="1" y="1" width="16" height="16" rx="3.5" fill="#0f9d58" />
    <path fill="#fff" d="M8.1 4.4h1.8v9.2H8.1z" />
    <path fill="#fff" d="M4.4 8.1h9.2v1.8H4.4z" />
  </svg>
);

/** "Link to Sheets" (dialog: connect Google, paste sheet URL) ⇄ "View in Sheets" pill. */
export default function SheetsLink({ formId, connected, googleEmail, linkedUrl, defaultUrl, autoOpen }: {
  formId: string;
  connected: boolean;
  googleEmail: string | null;
  linkedUrl: string | null;
  defaultUrl: string | null;
  autoOpen: boolean; // true when returning from the Google OAuth redirect — resume linking
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(autoOpen);
  const [state, formAction, pending] = useActionState<LinkState, FormData>(linkSheet, null);

  // Drop the ?google=... marker so a refresh doesn't reopen the dialog.
  useEffect(() => { if (autoOpen) window.history.replaceState(null, "", window.location.pathname); }, [autoOpen]);

  if (linkedUrl) {
    return (
      <span className="flex items-center gap-1">
        <a href={linkedUrl} target="_blank" rel="noopener" className="btn-secondary flex items-center gap-2">
          <SheetsGlyph /> View in Sheets
        </a>
        <form action={unlinkSheet} onSubmit={(e) => { if (!confirm("Unlink this sheet? Responses stop syncing; the sheet keeps its data.")) e.preventDefault(); }}>
          <input type="hidden" name="form_id" value={formId} />
          <button className="btn-text py-0.5 text-xs" title="Unlink sheet">Unlink</button>
        </form>
      </span>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-text flex items-center gap-2" style={{ color: "var(--g-blue)" }}>
        <SheetsGlyph /> Link to Sheets
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-24" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-medium"><SheetsGlyph /> Link to Sheets</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn-text"><Icon name="x" /></button>
            </div>
            {!connected ? (
              <div className="space-y-3 text-sm">
                <p style={{ color: "var(--g-grey-600)" }}>
                  Connect your Google account once, then responses to this form write themselves into a
                  spreadsheet of your choice — updated on every submission.
                </p>
                <a href={`/api/google/connect?next=${encodeURIComponent(pathname)}`} className="btn-primary inline-block">Connect Google account</a>
              </div>
            ) : (
              <form action={formAction} className="space-y-3 text-sm">
                <p style={{ color: "var(--g-grey-600)" }}>
                  Connected as <b>{googleEmail}</b>. Paste the link of a Google Sheet you can edit —
                  this form gets its own tab, rewritten on every submission.
                </p>
                <input type="hidden" name="form_id" value={formId} />
                <input name="url" required placeholder="https://docs.google.com/spreadsheets/d/…" defaultValue={defaultUrl ?? ""} className="input w-full" />
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="default" defaultChecked={!!defaultUrl} />
                  Set as default — future forms link to this spreadsheet automatically
                </label>
                {state?.error && <p style={{ color: "var(--g-red)" }}>{state.error}</p>}
                <div className="flex justify-end">
                  <button disabled={pending} className="btn-primary">{pending ? "Linking…" : "Link"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
