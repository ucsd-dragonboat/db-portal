"use client";

import { useState } from "react";
import { suggestMember, type CarpoolGuest, type GuestCol, type Origin, type SheetColumns, type SheetEntry } from "@db/carpool";
import Dialog from "@/components/dialog";
import { importResponseSheet, readResponseSheet, type SheetPreview } from "./sheet-import-actions";

const GRID = "#e0e0e0";
const cellBorder = { borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` };
const cell = "flex h-[22px] items-center px-1 text-[13px]";
const head = { background: "#f1f3f4" };
const COL_NAME: Record<GuestCol, string> = { drivers: "Driver", offCampus: "Ride · off", onCampus: "Ride · on", diy: "DIY" };

/** Right of the TOTAL panel: everyone in this layout who isn't on the day's roster
 * (write-ins and response-sheet imports). Linking one to a roster member swaps the
 * member into the guest's place, in this layout only. */
export function GuestsPanel({ guests, origins, roster, placedNote, onLink, onRemove, importButton }: {
  guests: CarpoolGuest[];
  origins: Record<string, Origin>;
  /** The day's roster, to link guests to. */
  roster: { id: string; name: string }[];
  placedNote: (id: string) => string;
  onLink: (pairs: { guestId: string; memberId: string }[]) => void;
  onRemove: (id: string) => void;
  importButton: React.ReactNode;
}) {
  const sorted = [...guests].sort((a, b) => a.name.localeCompare(b.name));
  const suggested = sorted.map((g) => ({ guestId: g.id, memberId: suggestMember(g.name, roster) })).filter((p): p is { guestId: string; memberId: string } => !!p.memberId);
  const suggestionOf = new Map(suggested.map((p) => [p.guestId, p.memberId]));
  const nameOf = new Map(roster.map((r) => [r.id, r.name]));
  return (
    <div className="w-[360px] shrink-0 self-start text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className={`${cell} justify-between font-medium`} style={{ ...cellBorder, ...head }}>
        <span>GUESTS <span className="font-normal" style={{ color: "var(--g-grey-600)" }}>{guests.length || ""}</span></span>
        {importButton}
      </div>
      {sorted.map((g) => {
        const o = origins[g.id];
        const needsPlace = g.col !== "diy" && !o?.location;
        const sug = suggestionOf.get(g.id);
        return (
          <div key={g.id} className="group flex bg-white" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `rider:${g.id}:roster`)}>
            <div className={`${cell} w-[110px] shrink-0 min-w-0 cursor-grab`} style={cellBorder} title={g.name}>
              <span className="truncate">{g.name}</span>
              <span className="ml-auto shrink-0 pl-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>{placedNote(g.id).replace(" · ", "")}</span>
            </div>
            <div className={`${cell} w-[64px] shrink-0 text-[11px]`} style={cellBorder}>{COL_NAME[g.col]}</div>
            <div className={`${cell} w-[60px] shrink-0 min-w-0 text-[11px]`} style={{ ...cellBorder, color: needsPlace ? "#9a6700" : undefined }}
              title={o ? `${o.text}${o.location ? "" : " — not found on the map; set it in Origins below"}` : "No starting point"}>
              <span className="truncate">{needsPlace ? "⚠ " : ""}{o?.text || "—"}</span>
            </div>
            <div className={`${cell} min-w-0 flex-1 gap-1`} style={cellBorder}>
              <select value="" onChange={(e) => e.target.value && onLink([{ guestId: g.id, memberId: e.target.value }])}
                className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" title="This guest is someone on the roster — swap them in">
                <option value="">{sug ? `Link: ${nameOf.get(sug)}?` : "Link to…"}</option>
                {sug && <option value={sug}>★ {nameOf.get(sug)}</option>}
                {roster.filter((r) => r.id !== sug).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" onClick={() => onRemove(g.id)} className="hidden shrink-0 text-slate-300 hover:text-red-600 group-hover:inline" title="Remove this guest">✕</button>
            </div>
          </div>
        );
      })}
      {!guests.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>No guests — write one in under TOTAL, or import a sheet.</div>}
      {suggested.length > 0 && (
        <button type="button" onClick={() => onLink(suggested)} className="w-full px-1 py-1 text-left text-[11px] underline" style={{ color: "var(--g-blue)" }}
          title={suggested.map((p) => `${guests.find((g) => g.id === p.guestId)?.name} → ${nameOf.get(p.memberId)}`).join("\n")}>
          Link all {suggested.length} suggested (★)
        </button>
      )}
      <p className="px-1 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>
        Guests aren&apos;t on the day&apos;s roster. Linking one swaps the member into the guest&apos;s seat — this layout only; RSVPs aren&apos;t changed. Guests aren&apos;t counted in Statistics.
      </p>
    </div>
  );
}

export type OriginRow = { id: string; name: string; role: "Driver" | "Rider"; guest: boolean; base: Origin | null; override: Origin | null };

/** Under the rides: where each off-campus rider and every driver starts from. Editing
 * one sets this layout's starting point for them (looked up on the map); ↺ goes back
 * to what their RSVP / home address says. */
export function OriginsPanel({ rows, onSet, onReset }: {
  rows: OriginRow[];
  onSet: (id: string, text: string) => Promise<void>;
  onReset: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const commit = async (r: OriginRow) => {
    const text = draft[r.id];
    setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; });
    if (text === undefined || text.trim() === (r.override ?? r.base)?.text) return;
    if (!text.trim()) { if (!r.guest) onReset(r.id); return; }
    setBusy((b) => ({ ...b, [r.id]: true }));
    try { await onSet(r.id, text.trim()); } finally { setBusy((b) => ({ ...b, [r.id]: false })); }
  };
  const sorted = [...rows].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "Driver" ? -1 : 1));
  return (
    <div className="w-max text-[13px]" style={{ borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
      <div className="flex font-bold" style={head}>
        <div className={`${cell} w-[150px] shrink-0`} style={cellBorder}>Off-campus &amp; drivers</div>
        <div className={`${cell} w-[60px] shrink-0`} style={cellBorder}>Role</div>
        <div className={`${cell} w-[300px] shrink-0`} style={cellBorder}>Starting from</div>
        <div className={`${cell} w-[90px] shrink-0`} style={cellBorder}>On map</div>
      </div>
      {sorted.map((r) => {
        const cur = r.override ?? r.base;
        return (
          <div key={r.id} className="flex bg-white">
            <div className={`${cell} w-[150px] shrink-0 min-w-0`} style={cellBorder} title={r.name}>
              <span className="truncate">{r.name}</span>{r.guest && <span className="ml-1 shrink-0 text-[10px]" style={{ color: "var(--g-grey-600)" }}>guest</span>}
            </div>
            <div className={`${cell} w-[60px] shrink-0 text-[12px]`} style={cellBorder}>{r.role}</div>
            <div className={`${cell} w-[300px] shrink-0 gap-1`} style={{ ...cellBorder, background: r.override && !r.guest ? "#fff8c5" : undefined }}>
              <input value={draft[r.id] ?? cur?.text ?? ""} placeholder={r.guest ? "where are they coming from?" : "Home address"}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; }); }}
                onBlur={() => commit(r)} disabled={busy[r.id]}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-300"
                title={r.override && !r.guest ? `This layout only — their RSVP says “${r.base?.text || "home"}”` : "Type an address or a pickup spot; Enter looks it up"} />
              {r.override && !r.guest && <button type="button" onClick={() => onReset(r.id)} className="shrink-0 text-[11px]" style={{ color: "#1a7f37" }} title="Back to their RSVP / home address">↺</button>}
            </div>
            <div className={`${cell} w-[90px] shrink-0 text-[12px]`} style={{ ...cellBorder, color: cur?.location ? "#1a7f37" : "#9a6700" }}>
              {busy[r.id] ? "looking up…" : cur?.location ? "✓ found" : "⚠ not found"}
            </div>
          </div>
        );
      })}
      {!rows.length && <div className={`${cell} bg-white`} style={{ ...cellBorder, color: "var(--g-grey-600)" }}>No drivers or off-campus riders yet.</div>}
      <p className="px-1 py-1 text-[10px]" style={{ color: "var(--g-grey-600)" }}>Yellow = changed for this layout only (Optimize and the map use it); ↺ goes back to the RSVP.</p>
    </div>
  );
}

const COL_FIELDS: { key: keyof SheetColumns; label: string; optional: boolean }[] = [
  { key: "name", label: "Name", optional: false },
  { key: "attending", label: "Attending / ride answer", optional: false },
  { key: "location", label: "Where they're coming from", optional: true },
  { key: "timestamp", label: "Timestamp (latest answer wins)", optional: true },
];

/** "Import sheet": paste a Google Form response sheet, check the columns, bring
 * everyone in as guests of this layout (latest answer per person). */
export function SheetImportButton({ eventId, connected, returnTo, known, onImport }: {
  eventId: string;
  connected: boolean;
  returnTo: string;
  known: Record<string, Origin>;
  onImport: (r: { entries: SheetEntry[]; notFound: string[]; skipped: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [cols, setCols] = useState<SheetColumns | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async (tab: string | null) => {
    setBusy("Reading the sheet…"); setError(null);
    const r = await readResponseSheet(url, tab).catch(() => ({ error: "Couldn't read the sheet — try again." }));
    setBusy(null);
    if ("error" in r) { setError(r.error); setPreview(null); return; }
    setPreview(r); setCols(r.cols ?? { timestamp: null, name: 0, attending: 1, location: null });
  };
  const run = async () => {
    if (!preview || !cols) return;
    setBusy("Importing — looking up where people are coming from (about a second each)…"); setError(null);
    const r = await importResponseSheet(eventId, url, preview.tab, cols, known).catch(() => ({ error: "Import failed — try again." }));
    setBusy(null);
    if ("error" in r) { setError(r.error); return; }
    onImport(r);
    setOpen(false);
  };
  const colLabel = (i: number) => `${String.fromCharCode(65 + (i % 26))}${preview?.header[i] ? ` · ${preview.header[i]}` : preview?.sample[0]?.[i] ? ` · e.g. “${preview.sample[0][i].slice(0, 30)}”` : ""}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-normal underline" style={{ color: "var(--g-blue)" }}
        title="Bring in a Google Form response sheet's people as guests">Import sheet</button>
      {open && (
        <Dialog title="Import a response sheet" onClose={() => setOpen(false)}>
          {!connected ? (
            <div className="space-y-3 text-sm">
              <p style={{ color: "var(--g-grey-600)" }}>Connect your Google account to read the sheet.</p>
              <a href={`/api/google/connect?next=${encodeURIComponent(returnTo)}`} className="btn-primary inline-block">Connect Google account</a>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p style={{ color: "var(--g-grey-600)" }}>
                Everyone in the sheet comes in as a <b>guest</b> of this layout — their latest answer decides driver / needs a ride /
                DIY, and where they&apos;re coming from is looked up on the map. Link guests to roster members afterwards.
                Importing again updates the same guests; a &ldquo;No&rdquo; removes one.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); read(null); }} className="flex gap-2">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the response sheet's URL" className="input min-w-0 flex-1" required />
                <button className="btn-secondary" disabled={!!busy}>Read</button>
              </form>
              {preview && cols && (
                <>
                  {preview.tabs.length > 1 && (
                    <label className="flex items-center gap-2">Tab
                      <select value={preview.tab} onChange={(e) => read(e.target.value)} className="input flex-1 py-1">
                        {preview.tabs.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </label>
                  )}
                  <p style={{ color: "var(--g-grey-600)" }}>{preview.rowCount} response{preview.rowCount === 1 ? "" : "s"}{preview.hasHeader ? "" : " (no header row)"}{preview.cols ? " — columns found; check them:" : " — couldn't tell which columns are which; pick them:"}</p>
                  <div className="space-y-1.5">
                    {COL_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-xs">
                        <span className="w-48 shrink-0">{f.label}</span>
                        <select value={cols[f.key] ?? ""} onChange={(e) => setCols({ ...cols, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                          className="input min-w-0 flex-1 py-1 text-xs">
                          {f.optional && <option value="">(none)</option>}
                          {preview.header.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" onClick={run} disabled={!!busy || cols.name === cols.attending} className="btn-primary">Import</button>
                  </div>
                </>
              )}
              {busy && <p style={{ color: "var(--g-grey-600)" }}>{busy}</p>}
              {error && <p style={{ color: "var(--g-red)" }}>{error}</p>}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
