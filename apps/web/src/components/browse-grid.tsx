"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Icon from "@/components/icon";

/** One browsable thing — a form, a carpool day, a lineup day. Everything the two
 * views need, in one shape, so the card and the row can never drift apart. */
export type BrowseItem = {
  id: string;
  href: string;
  title: string;
  /** Thumbnail preview lines; empty/omitted falls back to generic placeholder bars. */
  lines?: string[];
  /** Date line under the title (a <LocalTime>, "due …", whatever the page wants). */
  subtitle?: React.ReactNode;
  /** Status line, e.g. "Published · 12 going". */
  meta?: string;
  /** Colors the status dot (not the text) — green for published, and so on. */
  metaColor?: string;
  /** ⋮ menu, if the page has one. */
  menu?: React.ReactNode;
  /** ISO dates the sort options key off. */
  date?: string;
  modified?: string;
};

export type BrowseSort = { key: "date" | "modified" | "title"; label: string };
type View = "grid" | "list";

const grey = { color: "var(--g-grey-600)" };
const ms = (iso?: string) => (iso ? Date.parse(iso) : 0);

// Saved sort/view, per page, read through useSyncExternalStore (the same trick
// <LocalTime> uses): the server snapshot is "nothing saved", so first paint matches
// the server and the saved preference lands right after hydration.
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const prefKey = (key: string) => `db-browse-${key}`;
const readPref = (key: string) => { try { return localStorage.getItem(prefKey(key)); } catch { return null; } };

/** Sort comparators live here rather than being passed in: the Carpool and Lineups
 * day pickers render from server components, and functions can't cross that boundary. */
function compare(a: BrowseItem, b: BrowseItem, key: BrowseSort["key"]): number {
  if (key === "title") return a.title.localeCompare(b.title);
  return ms(key === "modified" ? b.modified : b.date) - ms(key === "modified" ? a.modified : a.date);
}

/** Mini document thumbnail: colored top bar + content lines, like the Google Forms
 * home cards. Exported for one-off thumbnails outside a grid (the template strip),
 * where `height` is "h-full" to fill a fixed-size tile. */
export function Thumb({ lines, color, soft, height = "h-24" }: { lines: string[] | undefined; color: string; soft: string; height?: string }) {
  return (
    <div className={`${height} overflow-hidden rounded-t-lg p-3`} style={{ background: soft }}>
      <div className="mx-auto h-full w-[85%] rounded-sm bg-white p-2 shadow-sm">
        <div className="h-1.5 w-full rounded-sm" style={{ background: color }} />
        {lines?.length
          ? lines.map((l, i) => <div key={i} className="mt-1.5 truncate text-[7px] leading-tight" style={grey}>{l}</div>)
          : [0, 1, 2].map((i) => <div key={i} className="mt-2 h-1 rounded-sm" style={{ background: "var(--g-grey-100)", width: `${85 - i * 20}%` }} />)}
      </div>
    </div>
  );
}

function Dot({ color }: { color?: string }) {
  return <span style={{ color: color ?? "var(--g-grey-600)" }}>●</span>;
}

function SortMenu({ sorts, value, onPick, color }: { sorts: BrowseSort[]; value: BrowseSort["key"]; onPick: (k: BrowseSort["key"]) => void; color: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Sort" aria-expanded={open} title="Sort"
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--g-grey-50)]" style={{ color }}>
        <Icon name="sortAz" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border bg-white py-1 text-sm shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
          {sorts.map((s) => (
            <button key={s.key} type="button" onClick={() => { onPick(s.key); setOpen(false); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--g-grey-50)]">
              <span className="w-4">{s.key === value && <Icon name="check" />}</span>{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One button that flips between the two layouts. Like Google Drive, it shows the
 * icon of the layout you'd switch *to*, so the icon changes each time it's clicked. */
function ViewToggle({ view, onPick, color }: { view: View; onPick: (v: View) => void; color: string }) {
  const next: View = view === "grid" ? "list" : "grid";
  const label = next === "list" ? "Switch to list view" : "Switch to grid view";
  return (
    <button type="button" onClick={() => onPick(next)} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--g-grey-50)]" style={{ color }}>
      <Icon name={next === "list" ? "list" : "table"} />
    </button>
  );
}

/** Google Drive-style browser: a heading row with sort + view controls, then the
 * items as cards or as rows. Both views render the same BrowseItems. The chosen
 * sort and view persist per page in localStorage. */
export default function BrowseGrid({ items, sorts, storageKey, color, soft, empty, heading, thumbHeight }: {
  items: BrowseItem[]; sorts: BrowseSort[]; storageKey: string;
  color: string; soft: string; empty: string; heading?: React.ReactNode;
  /** Tailwind height class for the card thumbnails (default "h-24"). */
  thumbHeight?: string;
}) {
  const raw = useSyncExternalStore(subscribe, () => readPref(storageKey), () => null);
  const saved = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as { sort?: string; view?: string }) : {}; } catch { return {}; }
  }, [raw]);
  const fallback = sorts[0]?.key ?? "date";
  const sort = sorts.some((s) => s.key === saved.sort) ? (saved.sort as BrowseSort["key"]) : fallback;
  const view: View = saved.view === "list" ? "list" : "grid";

  const save = (next: { sort?: BrowseSort["key"]; view?: View }) => {
    try { localStorage.setItem(prefKey(storageKey), JSON.stringify({ sort, view, ...next })); } catch { /* private mode / storage off */ }
    listeners.forEach((l) => l());
  };

  const sorted = useMemo(() => [...items].sort((a, b) => compare(a, b, sort)), [items, sort]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base">{heading}</h2>
        <div className="flex items-center gap-1">
          {sorts.length > 1 && <SortMenu sorts={sorts} value={sort} onPick={(k) => save({ sort: k })} color={color} />}
          <ViewToggle view={view} onPick={(v) => save({ view: v })} color={color} />
        </div>
      </div>

      {!sorted.length && <p className="text-sm" style={grey}>{empty}</p>}

      {view === "grid" ? (
        <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {sorted.map((it) => (
            <div key={it.id} className="card card-hover relative flex flex-col !p-0">
              <Link href={it.href} className="block"><Thumb lines={it.lines} color={color} soft={soft} height={thumbHeight} /></Link>
              <div className="flex items-start justify-between gap-1 p-3 pt-2 text-sm">
                <div className="min-w-0">
                  <Link href={it.href} className="block truncate font-medium hover:underline">{it.title}</Link>
                  {it.meta && (
                    <div className="mt-1 flex items-center gap-2 text-xs" style={grey}>
                      <Dot color={it.metaColor} /><span className="truncate">{it.meta}</span>
                    </div>
                  )}
                  {it.subtitle && <div className="mt-0.5 text-xs" style={grey}>{it.subtitle}</div>}
                </div>
                {it.menu}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--g-grey-300)" }}>
          {sorted.map((it, i) => (
            <div key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--g-grey-50)]"
              style={i ? { borderTop: "1px solid var(--g-grey-300)" } : undefined}>
              <span className="shrink-0" style={{ color }}><Icon name="file" /></span>
              <Link href={it.href} className="min-w-0 flex-1 truncate font-medium hover:underline">{it.title}</Link>
              {it.meta && (
                <span className="hidden min-w-0 shrink-0 items-center gap-2 text-xs sm:flex" style={grey}>
                  <Dot color={it.metaColor} /><span className="truncate">{it.meta}</span>
                </span>
              )}
              {it.subtitle && <span className="hidden shrink-0 text-xs md:block" style={grey}>{it.subtitle}</span>}
              <span className="shrink-0">{it.menu}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
