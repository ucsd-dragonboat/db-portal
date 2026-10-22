"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/icon";

/** The ⓘ beside Times Drove: which events someone drove for and how many times.
 * Hover (or focus) shows it; a click keeps it open until clicking it again, clicking
 * elsewhere, or Escape. */
export default function DrivesInfo({ items }: { items: { label: string; count: number }[] }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPinned(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPinned(false); setHover(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [pinned]);
  if (!items.length) return null;
  const open = hover || pinned;
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" onClick={() => setPinned((p) => !p)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        aria-label="Which events" aria-expanded={open} className="text-[11px] leading-none" style={{ color: pinned ? "var(--g-blue)" : "var(--g-grey-600)" }}>
        <Icon name="info" />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-full top-0 z-30 ml-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] leading-5 text-white shadow-lg"
          style={{ background: "#3c4043" }}>
          {items.map((it) => (
            <span key={it.label} className="block">{it.label} ({it.count > 0 && it.label === "Manual adjustment" ? `+${it.count}` : it.count})</span>
          ))}
        </span>
      )}
    </span>
  );
}
