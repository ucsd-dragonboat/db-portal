"use client";

import { useMemo, useState } from "react";
import Dialog from "@/components/dialog";
import { suggestSetName } from "@db/lineup";

export type FilingDay = { id: string; label: string; attending: number };
export type FilingGroup = { id: string; name: string; days: FilingDay[] };

/** Pick the event and which of its days this lineup covers, and confirm the name.
 * Reachable any time from the builder header — not only at publish. */
export default function FileDialog({ groups, groupId, dayIds, name, onCancel, onConfirm }: {
  groups: FilingGroup[];
  groupId: string | null;
  dayIds: string[];
  name: string;
  onCancel: () => void;
  onConfirm: (next: { groupId: string | null; dayIds: string[]; name: string }) => void;
}) {
  const [gid, setGid] = useState(groupId ?? groups[0]?.id ?? "");
  const [days, setDays] = useState<string[]>(dayIds);
  // Null until the coach types their own, so the suggestion stays live as they
  // change days — derived rather than synced, which keeps it out of an effect.
  const [custom, setCustom] = useState<string | null>(name.trim() ? name : null);

  const group = useMemo(() => groups.find((g) => g.id === gid) ?? null, [groups, gid]);
  // Days in the event's own order, so the suggested name spans first → last.
  const chosen = useMemo(() => (group?.days ?? []).filter((d) => days.includes(d.id)), [group, days]);
  const suggestion = useMemo(
    () => (group ? suggestSetName(group.name, chosen.map((d) => d.label)) : ""),
    [group, chosen],
  );

  const title = custom ?? suggestion;

  const toggleDay = (id: string) => setDays((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const pickGroup = (next: string) => { setGid(next); setDays([]); };

  return (
    <Dialog title="Which event is this lineup for?" onClose={onCancel}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="label">Event</span>
          <select value={gid} onChange={(e) => pickGroup(e.target.value)} className="input">
            {!groups.length && <option value="">No events yet</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>

        {group && (
          <div>
            <span className="label">Days this lineup covers</span>
            <div className="space-y-1">
              {group.days.map((d) => (
                <label key={d.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={days.includes(d.id)} onChange={() => toggleDay(d.id)} />
                  <span>{d.label}</span>
                  <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>
                    {d.attending} attending
                  </span>
                </label>
              ))}
              {!group.days.length && <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>This event has no days yet.</p>}
            </div>
          </div>
        )}

        <label className="block">
          <span className="label">Lineup name</span>
          <input value={title} onChange={(e) => setCustom(e.target.value)} className="input" />
          {custom === null && suggestion && (
            <span className="mt-1 block text-xs" style={{ color: "var(--g-grey-600)" }}>Suggested from the event and dates — edit if you like.</span>
          )}
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="button" className="btn-primary" disabled={!gid || !days.length}
            onClick={() => onConfirm({ groupId: gid || null, dayIds: chosen.map((d) => d.id), name: title.trim() || suggestion })}>
            Use {chosen.length || ""} day{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
