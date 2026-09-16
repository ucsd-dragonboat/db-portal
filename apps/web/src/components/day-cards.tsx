import LocalTime from "@/components/local-time";
import BrowseGrid, { type BrowseItem } from "@/components/browse-grid";

export type DayCard = { id: string; title: string; starts_at: string; meta: string; metaColor?: string; lines?: string[] };

/** Event-day picker for the Carpool and Lineups workspaces — a thin adapter over
 * <BrowseGrid>, so those pages get the same cards/rows, sort menu and view toggle
 * as the Forms page. Pass `lines` for a real content preview (e.g. rider counts);
 * omitted or empty falls back to generic placeholder bars. */
export default function DayCardGrid({ days, color, soft, hrefBase, empty, storageKey, heading = "Days" }: {
  days: DayCard[]; color: string; soft: string; hrefBase: string; empty: string;
  storageKey: string; heading?: React.ReactNode;
}) {
  const items: BrowseItem[] = days.map((d) => ({
    id: d.id,
    href: `${hrefBase}${d.id}`,
    title: d.title,
    lines: d.lines,
    subtitle: <LocalTime iso={d.starts_at} />,
    meta: d.meta,
    metaColor: d.metaColor,
    date: d.starts_at,
  }));
  return (
    <BrowseGrid items={items} storageKey={storageKey} color={color} soft={soft} empty={empty} heading={heading}
      sorts={[{ key: "date", label: "Event date" }, { key: "title", label: "Title" }]} />
  );
}
