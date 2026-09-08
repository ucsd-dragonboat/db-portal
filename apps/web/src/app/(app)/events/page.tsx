import Link from "next/link";
import Icon from "@/components/icon";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import type { EventGroup } from "@/lib/database.types";

// days that started up to 6h ago still show (in-progress)
const cutoffIso = () => new Date(Date.now() - 6 * 3600e3).toISOString();

/** Members: upcoming Events (containers) with their Day cards inside, organized into folders. */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { folder: folderId } = await searchParams;
  const { org, userId } = await requireOrg();
  const supabase = await createClient();
  const [{ data: days }, { data: groups }, { data: folders }] = await Promise.all([
    supabase.from("events").select("*, rsvps(user_id, status)").eq("org_id", org.id).gte("starts_at", cutoffIso()).order("starts_at"),
    supabase.from("event_groups").select("*").eq("org_id", org.id),
    supabase.from("event_folders").select("*").eq("org_id", org.id).order("name"),
  ]);
  type Day = NonNullable<typeof days>[number];
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const all: { group: EventGroup | null; days: Day[] }[] = [];
  for (const d of days ?? []) {
    const existing = d.group_id ? all.find((c) => c.group?.id === d.group_id) : null;
    if (existing) existing.days.push(d);
    else all.push({ group: d.group_id ? groupMap.get(d.group_id) ?? null : null, days: [d] });
  }
  const folder = folderId ? (folders ?? []).find((f) => f.id === folderId) ?? null : null;
  // In a folder: only its events. At root: unfiled events + folder cards (only folders with upcoming events).
  const containers = all.filter(({ group }) => (folder ? group?.folder_id === folder.id : (group?.folder_id ?? null) === null));
  const upcomingIn = (fid: string) => all.filter(({ group }) => group?.folder_id === fid).length;
  const visibleFolders = (folders ?? []).filter((f) => upcomingIn(f.id) > 0);

  const DayCard = ({ p }: { p: Day }) => {
    const rsvps = p.rsvps as { user_id: string; status: string }[];
    const mine = rsvps.find((r) => r.user_id === userId)?.status;
    const yes = rsvps.filter((r) => r.status === "yes").length;
    return (
      <Link href={`/events/${p.id}`} className="card card-hover flex items-center gap-4 !p-3">
        <div className="w-14 shrink-0 rounded-lg border text-center overflow-hidden" style={{ borderColor: "var(--g-grey-300)" }}>
          <div className="text-[10px] uppercase text-white py-0.5" style={{ background: "var(--g-blue)" }}><LocalTime iso={p.starts_at} mode="month" /></div>
          <div className="text-xl font-medium py-1"><LocalTime iso={p.starts_at} mode="day" /></div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{p.title}</div>
          <div className="text-sm text-slate-500"><LocalTime iso={p.starts_at} />{p.location_name && ` · ${p.location_name}`}</div>
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-500">{yes} going</div>
          <div className={mine ? "font-medium" : "text-amber-600"}>{mine ? `You: ${mine}` : "RSVP needed"}</div>
        </div>
      </Link>
    );
  };

  return (
    <div>
      {folder ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link href="/events" className="btn-text -ml-3">← Events</Link>
          <h1 className="text-2xl font-normal" style={{ color: "#5f6368" }}><Icon name="folder" /> {folder.name}</h1>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-normal mb-4">Events</h1>
          {visibleFolders.length > 0 && (
            <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {visibleFolders.map((f) => (
                <Link key={f.id} href={`/events?folder=${f.id}`}
                  className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm hover:bg-slate-50"
                  style={{ borderColor: "var(--g-grey-300)" }}>
                  <span style={{ color: "#5f6368" }}><Icon name="folder" className="text-lg" /></span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>{upcomingIn(f.id)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {!containers.length && <p className="text-slate-500">{folder ? "No upcoming events in this folder." : visibleFolders.length ? "No other upcoming events." : "No upcoming events."}</p>}
      <div className="space-y-4">
        {containers.map(({ group, days: ds }) => (
          <section key={group?.id ?? ds[0].id} className="rounded-xl border p-3" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-grey-50)" }}>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div>
                <Link href={group ? `/groups/${group.id}` : `/events/${ds[0].id}`} className="font-medium hover:underline">{group?.name ?? ds[0].title}</Link>
                <span className="ml-2 chip !py-0 text-[10px]">{group?.kind ?? ds[0].kind}</span>
              </div>
              {group && <Link href={`/groups/${group.id}`} className="btn-text -mr-2 py-0.5">Lineups & rides →</Link>}
            </div>
            <div className="space-y-2">{ds.map((p) => <DayCard key={p.id} p={p} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
