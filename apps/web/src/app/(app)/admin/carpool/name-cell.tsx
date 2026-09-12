"use client";

import { useRef, useState } from "react";

export type NameOption = { id: string; name: string };

/** One sheet cell: a draggable name chip when filled, or a type-ahead input when
 * empty (filtered suggestions; Tab/Enter/click accepts, Escape clears, blur keeps
 * only an exact match). The whole cell doubles as a drop target. */
export default function NameCell({ value, options, onPick, onClear, dragPayload, onDropRider, disabled = false, className = "" }: {
  value: NameOption | null;
  options: NameOption[];
  onPick: (id: string) => void;
  onClear?: () => void;
  /** dataTransfer payload when the filled chip is dragged. */
  dragPayload?: string;
  onDropRider?: (payload: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = q.trim() ? options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];

  const accept = (o: NameOption) => { onPick(o.id); setQ(""); setOpen(false); setHi(0); };

  const dropProps = onDropRider && !disabled ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); onDropRider(e.dataTransfer.getData("text/plain")); },
  } : {};

  // Spreadsheet-cell look: 22px rows, 13px text, light gridlines like the template.
  const base = `flex h-[22px] items-center px-1 text-[13px] ${over ? "ring-2 ring-inset ring-sky-400" : ""} ${className}`;
  const border = { borderRight: "1px solid #e0e0e0", borderBottom: "1px solid #e0e0e0" };

  if (disabled) return <div className={base} style={{ background: "#f3f3f3", ...border }} />;

  if (value) {
    return (
      <div {...dropProps} className={`${base} justify-between gap-1 bg-white`} style={border}>
        <span draggable={!!dragPayload} onDragStart={(e) => dragPayload && e.dataTransfer.setData("text/plain", dragPayload)}
          className={`min-w-0 flex-1 truncate ${dragPayload ? "cursor-grab" : ""}`}>{value.name}</span>
        {onClear && <button type="button" onClick={onClear} tabIndex={-1} aria-label={`Remove ${value.name}`} className="shrink-0 text-slate-300 hover:text-red-600">✕</button>}
      </div>
    );
  }

  return (
    <div {...dropProps} className={`relative ${base} bg-white`} style={border}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (!open || !matches.length) { if (e.key === "Escape") { setQ(""); setOpen(false); } return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); accept(matches[hi]); }
          else if (e.key === "Escape") { setQ(""); setOpen(false); }
        }}
        onBlur={() => {
          const exact = options.find((o) => o.name.toLowerCase() === q.trim().toLowerCase());
          if (exact) accept(exact);
          else { setQ(""); setOpen(false); }
        }}
        placeholder=""
        className="w-full min-w-0 bg-transparent text-[13px] outline-none"
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 top-full z-30 max-h-52 w-52 overflow-y-auto border bg-white text-[13px] shadow-lg" style={{ borderColor: "#e0e0e0" }}>
          {matches.map((o, i) => (
            <li key={o.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); accept(o); }}
                className={`w-full truncate px-2 py-1 text-left ${i === hi ? "bg-sky-100" : "hover:bg-slate-50"}`}>
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
