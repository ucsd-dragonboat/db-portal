import Link from "next/link";
import LocalTime from "@/components/local-time";

export type DayCard = { id: string; title: string; starts_at: string; meta: string; metaColor?: string; lines?: string[] };

/** Google Forms-style grid of event-day cards, tinted per section (blue lineups, red carpool).
 * Pass `lines` for a real content preview (like the Forms page's thumbnails, e.g. rider counts);
 * omitted or empty falls back to generic placeholder bars. */
export default function DayCardGrid({ days, color, soft, hrefBase, empty }: {
  days: DayCard[]; color: string; soft: string; hrefBase: string; empty: string;
}) {
  if (!days.length) return <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>{empty}</p>;
  return (
    <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
      {days.map((d) => (
        <Link key={d.id} href={`${hrefBase}${d.id}`} className="card card-hover flex flex-col !p-0">
          <div className="h-24 overflow-hidden rounded-t-lg p-3" style={{ background: soft }}>
            <div className="mx-auto h-full w-[85%] rounded-sm bg-white p-2 shadow-sm">
              <div className="h-1.5 w-full rounded-sm" style={{ background: color }} />
              {d.lines?.length
                ? d.lines.map((l, i) => <div key={i} className="mt-1.5 truncate text-[7px] leading-tight" style={{ color: "var(--g-grey-600)" }}>{l}</div>)
                : [0, 1, 2].map((i) => <div key={i} className="mt-2 h-1 rounded-sm" style={{ background: "var(--g-grey-100)", width: `${85 - i * 20}%` }} />)}
            </div>
          </div>
          <div className="p-3 pt-2 text-sm">
            <div className="truncate font-medium">{d.title}</div>
            <div className="mt-1 text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={d.starts_at} /></div>
            <div className="mt-0.5 text-xs" style={{ color: d.metaColor ?? "var(--g-grey-600)" }}>{d.meta}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
