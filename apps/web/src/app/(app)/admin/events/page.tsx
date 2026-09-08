import Link from "next/link";
import Icon from "@/components/icon";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import { createFolder, deleteEvent, deleteFolder, deleteGroup, renameFolder } from "../actions";
import { DraggableEvent, FolderDropTarget } from "./dnd";
import { createFormForGroup } from "../forms/actions";
import ConfirmForm from "@/components/confirm-form";
import type { EventFolder, EventGroup } from "@/lib/database.types";

/** Admin: Events are containers; each holds Day cards. Containers organize into Drive-style folders. */
export default async function AdminEventsPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { folder: folderId } = await searchParams;
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const [{ data: days }, { data: groups }, { data: folders }] = await Promise.all([
    supabase.from("events").select("*, rsvps(status)").eq("org_id", org.id).order("starts_at", { ascending: false }).limit(120),
    supabase.from("event_groups").select("*").eq("org_id", org.id),
    supabase.from("event_folders").select("*").eq("org_id", org.id).order("name"),
  ]);
  type Day = NonNullable<typeof days>[number];
  const byGroup = new Map<string, Day[]>();
  const loose: Day[] = [];
  for (const d of days ?? []) { if (d.group_id) { byGroup.set(d.group_id, [...(byGroup.get(d.group_id) ?? []), d]); } else loose.push(d); }
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const folder = folderId ? (folders ?? []).find((f) => f.id === folderId) ?? null : null;

  // Containers: real events (groups) + legacy loose days as their own container, sorted by most recent day.
  const all: { group: EventGroup | null; days: Day[] }[] = [
    ...[...byGroup.entries()].map(([gid, ds]) => ({ group: groupMap.get(gid) ?? null, days: [...ds].sort((a, b) => a.starts_at.localeCompare(b.starts_at)) })),
    ...loose.map((d) => ({ group: null, days: [d] })),
  ].sort((a, b) => b.days[b.days.length - 1].starts_at.localeCompare(a.days[a.days.length - 1].starts_at));
  // In a folder: only its events. At root: events not in any folder.
  const containers = all.filter(({ group }) => (folder ? group?.folder_id === folder.id : (group?.folder_id ?? null) === null));
  const countIn = (f: EventFolder) => (groups ?? []).filter((g) => g.folder_id === f.id).length;

  return (
    <div className="mx-auto max-w-[1000px]">
      <section>
        {folder ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FolderDropTarget folderId={null}>
              <Link href="/admin/events" className="btn-text -ml-3" title="Drop an event here to move it out of this folder">← All events</Link>
            </FolderDropTarget>
            <h2 className="text-lg font-medium" style={{ color: "#5f6368" }}><Icon name="folder" /> {folder.name}</h2>
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500 underline">rename</summary>
              <form action={renameFolder} className="mt-1 flex items-center gap-1">
                <input type="hidden" name="id" value={folder.id} />
                <input name="name" defaultValue={folder.name} required className="input w-40 py-1" />
                <button className="btn-secondary py-1">Save</button>
              </form>
            </details>
            <ConfirmForm action={deleteFolder} message={`Delete folder "${folder.name}"? Its events are kept and move back to All events.`}>
              <input type="hidden" name="id" value={folder.id} />
              <button className="btn-danger-text py-0.5 text-xs">Delete folder</button>
            </ConfirmForm>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-medium">Folders</h2>
              <form action={createFolder} className="flex items-center gap-1 text-xs">
                <input name="name" required placeholder="New folder…" className="input w-36 py-1" />
                <button className="btn-secondary py-1">+ <Icon name="folder" /></button>
              </form>
            </div>
            {(folders ?? []).length > 0 && (
              <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {(folders ?? []).map((f) => (
                  <FolderDropTarget key={f.id} folderId={f.id}>
                    <Link href={`/admin/events?folder=${f.id}`}
                      className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm hover:bg-slate-50"
                      style={{ borderColor: "var(--g-grey-300)" }}>
                      <span style={{ color: "#5f6368" }}><Icon name="folder" className="text-lg" /></span>
                      <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                      <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>{countIn(f)}</span>
                    </Link>
                  </FolderDropTarget>
                ))}
              </div>
            )}
            <h2 className="text-lg font-medium mb-3">All events <span className="ml-1 text-xs font-normal" style={{ color: "var(--g-grey-600)" }}>drag one onto a folder to file it</span></h2>
          </>
        )}
        <div className="space-y-3">
          {containers.map(({ group, days: ds }) => {
            const total = ds.reduce((a, d) => a + (d.rsvps as { status: string }[]).filter((r) => r.status === "yes").length, 0);
            const card = (
              <div className="rounded-lg border" style={{ borderColor: "var(--g-grey-300)", background: "#fff" }}>
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-grey-50)" }}>
                  <div className="min-w-0 flex-1">
                    <Link href={group ? `/groups/${group.id}` : `/events/${ds[0].id}`} className="font-medium hover:underline">{group?.name ?? ds[0].title}</Link>
                    <span className="ml-2 text-[10px] uppercase" style={{ color: "var(--g-grey-600)" }}>{group?.kind ?? ds[0].kind} · {ds.length} day{ds.length === 1 ? "" : "s"} · {total} yes</span>
                  </div>
                  {group && (
                    <div className="flex items-center gap-1 text-xs">
                      <Link href={`/groups/${group.id}`} className="btn-text py-0.5">Overview</Link>
                      <form action={createFormForGroup}><input type="hidden" name="group_id" value={group.id} /><button className="btn-text py-0.5"><Icon name="form" /> Form</button></form>
                      <ConfirmForm action={deleteGroup} message={`Delete "${group.name}" and all ${ds.length} of its days?`}><input type="hidden" name="id" value={group.id} /><input type="hidden" name="with_events" value="on" /><button className="btn-danger-text py-0.5">Delete</button></ConfirmForm>
                    </div>
                  )}
                </div>
                <ul className="divide-y" style={{ borderColor: "var(--g-grey-300)" }}>
                  {ds.map((p) => {
                    const r = p.rsvps as { status: string }[];
                    const c = (s: string) => r.filter((x) => x.status === s).length;
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <div className="w-12 shrink-0 rounded border text-center overflow-hidden text-[10px]" style={{ borderColor: "var(--g-grey-300)" }}>
                          <div className="uppercase text-white" style={{ background: "var(--g-blue)" }}><LocalTime iso={p.starts_at} mode="month" /></div>
                          <div className="text-base font-medium leading-tight py-0.5"><LocalTime iso={p.starts_at} mode="day" /></div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={`/events/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                          <div className="text-xs" style={{ color: "var(--g-grey-600)" }}><LocalTime iso={p.starts_at} /> · <Icon name="yes" /> {c("yes")} · <Icon name="maybe" /> {c("maybe")} · <Icon name="no" /> {c("no")}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-xs">
                          <Link href={`/admin/lineups?event=${p.id}`} className="btn-text py-0.5">Lineups</Link>
                          <Link href={`/admin/carpool?event=${p.id}`} className="btn-text py-0.5">Carpool</Link>
                          <ConfirmForm action={deleteEvent} message={`Delete "${p.title}"?`}><input type="hidden" name="id" value={p.id} /><button className="btn-danger-text py-0.5" title="Delete day">✕</button></ConfirmForm>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
            const key = group?.id ?? ds[0].id;
            return group ? <DraggableEvent key={key} groupId={group.id}>{card}</DraggableEvent> : <div key={key}>{card}</div>;
          })}
          {!containers.length && <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>{folder ? "This folder is empty — drag an event onto the folder, or create one with the ➕ in the top bar." : "No events yet — create one with the ➕ in the top bar."}</p>}
        </div>
      </section>
    </div>
  );
}
