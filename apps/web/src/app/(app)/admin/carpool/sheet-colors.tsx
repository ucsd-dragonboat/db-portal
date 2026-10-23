"use client";

// The layout's colour scheme for the builder's sheet, and the Google Sheets–style colour
// picker that opens when a coloured bar is clicked. Colours live on the layout
// (CarpoolDataV2.colors) and Copy for Sheets pastes them too.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_SHEET_COLORS, SHEET_COLOR_DEFS, textOn, type SheetColorKey } from "@db/carpool";

type Ctx = { c: Record<SheetColorKey, string>; pick: (key: SheetColorKey, e: React.MouseEvent) => void };
const SheetColorsContext = createContext<Ctx>({ c: DEFAULT_SHEET_COLORS, pick: () => {} });
export const SheetColorsProvider = SheetColorsContext.Provider;
export const useSheetColors = () => useContext(SheetColorsContext);

/** Props that make a coloured bar open the picker for its colour (and text readable on it). */
export function colorBar(ctx: Ctx, key: SheetColorKey) {
  return {
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) ctx.pick(key, e); },
    style: { background: ctx.c[key], color: textOn(ctx.c[key]), cursor: "pointer" } as React.CSSProperties,
    title: `${SHEET_COLOR_DEFS[key].label} — click to change the colour`,
  };
}

// Google Sheets' palette: greys, then the bright row, then light → dark tints.
const PALETTE = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
];

const toRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, "0")).join("")}`;

/** Swatches, a custom colour as HEX or R/G/B, and Reset to the Master Sheet's colour. */
export function ColorPicker({ colorKey, value, x, y, onPick, onClose }: {
  colorKey: SheetColorKey; value: string; x: number; y: number; onPick: (hex: string | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(value);
  const [rgb, setRgb] = useState(toRgb(value));
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const valid = /^#?[0-9a-f]{6}$/i.test(hex.trim());
  const setFromHex = (v: string) => { setHex(v); if (/^#?[0-9a-f]{6}$/i.test(v.trim())) setRgb(toRgb(`#${v.trim().replace("#", "")}`)); };
  const setChannel = (i: number, v: string) => { const next = rgb.map((c, k) => (k === i ? Number(v) : c)); setRgb(next); setHex(toHex(next)); };
  const apply = () => { if (valid) onPick(`#${hex.trim().replace("#", "").toLowerCase()}`); };
  const left = Math.min(x, (typeof window === "undefined" ? 9999 : window.innerWidth) - 260);
  return (
    <div ref={ref} role="dialog" aria-label={`${SHEET_COLOR_DEFS[colorKey].label} colour`} className="fixed z-50 w-[250px] space-y-2 rounded-lg bg-white p-3 text-xs shadow-xl"
      style={{ left: Math.max(8, left), top: y + 6, border: "1px solid var(--g-grey-300)" }}>
      <div className="font-medium text-sm">{SHEET_COLOR_DEFS[colorKey].label}</div>
      <div className="grid grid-cols-10 gap-1">
        {PALETTE.flat().map((c) => (
          <button key={c} type="button" onClick={() => onPick(c)} aria-label={c} title={c}
            className="h-5 w-5 rounded-full" style={{ background: c, outline: c === value ? "2px solid #1a73e8" : "1px solid #0000001a", outlineOffset: c === value ? 1 : -1 }} />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="h-6 w-6 shrink-0 rounded" style={{ background: valid ? `#${hex.trim().replace("#", "")}` : value, border: "1px solid #0000001a" }} />
        <label className="flex items-center gap-1">HEX
          <input value={hex} onChange={(e) => setFromHex(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="input w-[76px] py-0.5 font-mono text-xs" aria-label="Hex colour" />
        </label>
      </div>
      <div className="flex items-center gap-1">
        {(["R", "G", "B"] as const).map((ch, i) => (
          <label key={ch} className="flex items-center gap-0.5">{ch}
            <input type="number" min={0} max={255} value={rgb[i]} onChange={(e) => setChannel(i, e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()}
              className="input w-[52px] py-0.5 text-xs" aria-label={`${ch} (0–255)`} />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => onPick(null)} className="btn-text py-0.5 text-xs">Reset</button>
        <span className="flex gap-1">
          <button type="button" onClick={onClose} className="btn-text py-0.5 text-xs">Cancel</button>
          <button type="button" onClick={apply} disabled={!valid} className="btn-primary py-0.5 text-xs disabled:opacity-50">Apply</button>
        </span>
      </div>
    </div>
  );
}
