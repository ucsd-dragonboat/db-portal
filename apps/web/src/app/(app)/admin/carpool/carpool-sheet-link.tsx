"use client";

import { useActionState, useEffect, useState } from "react";
import Dialog from "@/components/dialog";
import ConfirmForm from "@/components/confirm-form";
import { searchSheets, type DriveSearch } from "../forms/[id]/responses/actions";
import { linkCarpoolSheet, unlinkCarpoolSheet } from "./actions";

const SheetsGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden className="inline-block align-[-3px]">
    <rect x="1" y="1" width="16" height="16" rx="3.5" fill="#0f9d58" />
    <path fill="#fff" d="M8.1 4.4h1.8v9.2H8.1z" />
    <path fill="#fff" d="M4.4 8.1h9.2v1.8H4.4z" />
  </svg>
);

/** The team's carpool spreadsheet: "Link to Sheets" (connect Google, pick a sheet) ⇄ "View in Sheets".
 * Once linked it's the default for every layout — publishing writes the layout's rides tab there. */
export default function CarpoolSheetLink({ connected, googleEmail, sheetUrl, tabUrl, autoOpen, returnTo }: {
  connected: boolean;
  googleEmail: string | null;
  sheetUrl: string | null; // the linked spreadsheet
  tabUrl: string | null; // this layout's tab, once a publish wrote one
  autoOpen: boolean; // back from the Google OAuth redirect — resume linking
  returnTo: string; // this day/layout's URL, for the Google OAuth round trip
}) {
  const [open, setOpen] = useState(autoOpen);
  // A successful link closes the dialog.
  const [state, formAction, pending] = useActionState(async (prev: { error?: string } | null, fd: FormData) => {
    const r = await linkCarpoolSheet(prev, fd);
    if (r && !r.error) setOpen(false);
    return r;
  }, null);
  const [q, setQ] = useState(sheetUrl ?? "");
  const [drive, setDrive] = useState<DriveSearch | null>(null);

  const looksLikeUrl = /^https?:\/\//.test(q.trim()) || q.includes("docs.google.com/");
  const term = looksLikeUrl ? "" : q.trim();
  useEffect(() => {
    if (!open || !connected) return;
    const t = setTimeout(() => { searchSheets(term).then(setDrive).catch(() => {}); }, term ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, connected, term]);
  const selectedId = q.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

  // Drop the ?google=... marker (keeping the day/layout) so a refresh doesn't reopen the dialog.
  useEffect(() => { if (autoOpen) window.history.replaceState(null, "", returnTo); }, [autoOpen, returnTo]);

  return (
    <>
      {sheetUrl ? (
        <span className="flex items-center gap-1 text-xs">
          <a href={tabUrl ?? sheetUrl} target="_blank" rel="noopener" className="btn-text flex items-center gap-1.5 py-1 text-xs"
            title={tabUrl ? "Open this layout's tab in the team's carpool sheet" : "Publish this layout to give it a tab in the team's carpool sheet"}>
            <SheetsGlyph /> {tabUrl ? "View in Sheets" : "Carpool sheet"}
          </a>
          <button type="button" onClick={() => setOpen(true)} className="btn-text py-1 text-xs" title="Pick a different carpool spreadsheet">Change</button>
          <ConfirmForm action={unlinkCarpoolSheet} message="Unlink the carpool sheet? Publishing stops writing tabs; the sheet keeps what it has.">
            <button className="btn-text py-1 text-xs">Unlink</button>
          </ConfirmForm>
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-text flex items-center gap-1.5 py-1 text-xs" style={{ color: "var(--g-blue)" }}
          title="Publishing a layout then writes its rides tab into this spreadsheet">
          <SheetsGlyph /> Link to Sheets
        </button>
      )}
      {open && (
        <Dialog title={<span className="flex items-center gap-2"><SheetsGlyph /> Carpool sheet</span>} onClose={() => setOpen(false)}>
          {!connected ? (
            <div className="space-y-3 text-sm">
              <p style={{ color: "var(--g-grey-600)" }}>
                Connect your Google account once, then every published layout writes its rides tab into
                the team&apos;s carpool spreadsheet automatically.
              </p>
              <a href={`/api/google/connect?next=${encodeURIComponent(returnTo)}`} className="btn-primary inline-block">Connect Google account</a>
            </div>
          ) : (
            <form action={formAction} className="space-y-3 text-sm">
              <p style={{ color: "var(--g-grey-600)" }}>
                Connected as <b>{googleEmail}</b>. Pick a spreadsheet you can edit — it becomes the team&apos;s
                default carpool sheet. Publishing a layout adds a tab like <b>Saturday Rides (Practice)</b>, and
                publishing it again rewrites that tab.
              </p>
              <input name="url" required placeholder="Search in Drive or paste URL" value={q} onChange={(e) => setQ(e.target.value)} className="input w-full" />
              {drive && "error" in drive ? (
                <p style={{ color: "var(--g-grey-600)" }}>
                  {drive.error === "reconnect"
                    ? <>Browsing Drive needs a quick <a href={`/api/google/connect?next=${encodeURIComponent(returnTo)}`} className="underline" style={{ color: "var(--g-blue)" }}>reconnect</a> — pasting a link still works.</>
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
