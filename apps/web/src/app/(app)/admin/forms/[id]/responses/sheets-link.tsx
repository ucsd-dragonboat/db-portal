"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Dialog from "@/components/dialog";
import ConfirmForm from "@/components/confirm-form";
import { linkSheet, searchSheets, unlinkSheet, type DriveSearch, type LinkState } from "./actions";

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
  const [q, setQ] = useState(defaultUrl ?? "");
  const [drive, setDrive] = useState<DriveSearch | null>(null);

  // Drive picker: browse recents on open; debounce name search while typing (URLs skip the search).
  const looksLikeUrl = /^https?:\/\//.test(q.trim()) || q.includes("docs.google.com/");
  const term = looksLikeUrl ? "" : q.trim();
  useEffect(() => {
    if (!open || !connected) return;
    const t = setTimeout(() => { searchSheets(term).then(setDrive).catch(() => {}); }, term ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, connected, term]);
  const selectedId = q.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

  // Drop the ?google=... marker so a refresh doesn't reopen the dialog.
  useEffect(() => { if (autoOpen) window.history.replaceState(null, "", window.location.pathname); }, [autoOpen]);

  if (linkedUrl) {
    return (
      <span className="flex items-center gap-1">
        <a href={linkedUrl} target="_blank" rel="noopener" className="btn-secondary flex items-center gap-2">
          <SheetsGlyph /> View in Sheets
        </a>
        <ConfirmForm action={unlinkSheet} message="Unlink this sheet? Responses stop syncing; the sheet keeps its data.">
          <input type="hidden" name="form_id" value={formId} />
          <button className="btn-text py-0.5 text-xs" title="Unlink sheet">Unlink</button>
        </ConfirmForm>
      </span>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-text flex items-center gap-2" style={{ color: "var(--g-blue)" }}>
        <SheetsGlyph /> Link to Sheets
      </button>
      {open && (
        <Dialog title={<span className="flex items-center gap-2"><SheetsGlyph /> Link to Sheets</span>} onClose={() => setOpen(false)}>
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
                  Connected as <b>{googleEmail}</b>. Pick a spreadsheet you can edit —
                  this form gets its own tab, rewritten on every submission.
                </p>
                <input type="hidden" name="form_id" value={formId} />
                <input name="url" required placeholder="Search in Drive or paste URL" value={q} onChange={(e) => setQ(e.target.value)} className="input w-full" />
                {drive && "error" in drive ? (
                  <p style={{ color: "var(--g-grey-600)" }}>
                    {drive.error === "reconnect"
                      ? <>Browsing Drive needs a quick <a href={`/api/google/connect?next=${encodeURIComponent(pathname)}`} className="underline" style={{ color: "var(--g-blue)" }}>reconnect</a> — pasting a link still works.</>
                      : "Couldn't reach Google Drive — paste a link instead."}
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--g-grey-300)" }}>
                    {(drive?.sheets ?? []).map((s) => (
                      <button key={s.id} type="button" onClick={() => setQ(`https://docs.google.com/spreadsheets/d/${s.id}/edit`)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                        style={selectedId === s.id ? { background: "#e8f0fe" } : undefined}>
                        <SheetsGlyph />
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="shrink-0 text-xs" style={{ color: "var(--g-grey-600)" }}>{s.modifiedTime ? new Date(s.modifiedTime).toLocaleDateString() : ""}</span>
                      </button>
                    ))}
                    {drive && !drive.sheets.length && <p className="px-3 py-2" style={{ color: "var(--g-grey-600)" }}>{term ? "No spreadsheets match." : "No spreadsheets found — paste a link instead."}</p>}
                    {!drive && <p className="px-3 py-2" style={{ color: "var(--g-grey-600)" }}>Loading your spreadsheets…</p>}
                  </div>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="default" defaultChecked={!!defaultUrl} />
                  Set as default — future forms link to this spreadsheet automatically
                </label>
                {state?.error && <p style={{ color: "var(--g-red)" }}>{state.error}</p>}
                <div className="flex justify-end">
                  <button disabled={pending || !selectedId} className="btn-primary">{pending ? "Linking…" : "Link"}</button>
                </div>
              </form>
            )}
        </Dialog>
      )}
    </>
  );
}
