"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { attendeesForDays } from "@/lib/attendees";
import type { Lineup, BoatType } from "@db/lineup";
import type { Json } from "@/lib/database.types";

/** Members see lineups on the event and group pages, not just /admin/lineups. */
async function revalidateLineupPaths(eventId: string | null) {
  await revalidateDays(eventId ? [eventId] : []);
}

async function revalidateDays(eventIds: string[]) {
  revalidatePath("/admin/lineups");
  if (!eventIds.length) return;
  const supabase = await createClient();
  const { data: evs } = await supabase.from("events").select("id, group_id").in("id", eventIds);
  const groups = new Set<string>();
  for (const ev of evs ?? []) {
    revalidatePath(`/events/${ev.id}`);
    if (ev.group_id) groups.add(ev.group_id);
  }
  for (const g of groups) revalidatePath(`/groups/${g}`);
}

/** One boat on one day, as the builder holds it before it becomes a lineups row. */
export type BoatInput = {
  id: string | null;        // existing lineups.id when this boat/day already exists
  eventId: string | null;   // null = not filed to a day yet
  name: string;
  boatType: BoatType;
  division: string | null;
  boatLabel: string | null;
  data: Lineup;
};

/**
 * Writes a whole builder session at once: every boat, across every day it's filed
 * to. Rows of this set that are no longer present get deleted, so changing which
 * days a lineup covers moves it rather than leaving orphans behind.
 */
export async function saveLineupSet(input: {
  setId: string;
  boats: BoatInput[];
  published: boolean;
}): Promise<{ error: string } | { ids: string[] }> {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  if (!input.boats.length) return { error: "Add a boat before saving." };

  // Days touched before and after, so both the old and new ones get revalidated.
  const { data: existing } = await supabase.from("lineups")
    .select("id, event_id").eq("org_id", org.id).eq("set_id", input.setId);
  const days = new Set<string>();
  for (const r of existing ?? []) if (r.event_id) days.add(r.event_id);

  const ids: string[] = [];
  for (const b of input.boats) {
    const row = {
      org_id: org.id, event_id: b.eventId, name: b.name, boat_type: b.boatType,
      division: b.division, boat_label: b.boatLabel, set_id: input.setId,
      data: b.data as unknown as Json, published: input.published,
    };
    if (b.eventId) days.add(b.eventId);
    // created_by is set once, on insert — an edit by another admin shouldn't reassign it.
    const q = b.id
      ? supabase.from("lineups").update(row).eq("id", b.id).eq("org_id", org.id).select("id").single()
      : supabase.from("lineups").insert({ ...row, created_by: userId }).select("id").single();
    const { data, error } = await q;
    if (error) return { error: error.message };
    ids.push(data.id);
  }

  const stale = (existing ?? []).filter((r) => !ids.includes(r.id)).map((r) => r.id);
  if (stale.length) await supabase.from("lineups").delete().eq("org_id", org.id).in("id", stale);

  await revalidateDays([...days]);
  return { ids };
}

/** Attending (yes-only) ids per day — the builder calls this when its days change. */
export async function fetchAttendees(eventIds: string[]): Promise<Record<string, string[]>> {
  await requireAdmin();
  const supabase = await createClient();
  const byDay = await attendeesForDays(supabase, eventIds);
  return Object.fromEntries([...byDay].map(([eid, people]) => [eid, people.map((p) => p.id)]));
}

/** Removes an entire set — every boat on every day it was filed to. */
export async function deleteLineupSet(setId: string) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { data: rows } = await supabase.from("lineups").select("event_id").eq("org_id", org.id).eq("set_id", setId);
  await supabase.from("lineups").delete().eq("org_id", org.id).eq("set_id", setId);
  await revalidateDays([...new Set((rows ?? []).map((r) => r.event_id).filter((x): x is string => !!x))]);
}

export async function saveLineup(input: {
  id: string | null;
  eventId: string | null;
  name: string;
  boatType: BoatType;
  division: string | null;
  boatLabel: string | null;
  data: Lineup;
  published: boolean;
}) {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const row = {
    org_id: org.id, event_id: input.eventId, name: input.name, boat_type: input.boatType,
    division: input.division, boat_label: input.boatLabel,
    data: input.data as unknown as Json, published: input.published,
  };
  // org scoping on the update as well as RLS; created_by stays with whoever made it.
  const q = input.id
    ? supabase.from("lineups").update(row).eq("id", input.id).eq("org_id", org.id).select("id").single()
    : supabase.from("lineups").insert({ ...row, created_by: userId }).select("id").single();
  const { data, error } = await q;
  if (error) return { error: error.message };
  await revalidateLineupPaths(input.eventId);
  return { id: data.id };
}

export async function deleteLineup(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: row } = await supabase.from("lineups").select("event_id").eq("id", id).maybeSingle();
  await supabase.from("lineups").delete().eq("id", id);
  await revalidateLineupPaths(row?.event_id ?? null);
}

/** Renames (and optionally re-types) a division across all its boats/races for one day. */
export async function renameDivision(fd: FormData) {
  const { org } = await requireAdmin();
  const eventId = String(fd.get("event_id"));
  const from = String(fd.get("from"));
  const to = String(fd.get("to") ?? "").trim();
  const boatType = String(fd.get("boat_type") ?? "") as BoatType | "";
  if (!eventId || !from || !to) return;
  const supabase = await createClient();
  await supabase
    .from("lineups")
    .update(boatType ? { division: to, boat_type: boatType } : { division: to })
    .eq("org_id", org.id).eq("event_id", eventId).eq("division", from);
  await revalidateLineupPaths(eventId);
}
