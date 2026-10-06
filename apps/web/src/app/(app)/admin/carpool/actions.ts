"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { layoutMembers, upgradeCarpoolData, type CarpoolDataV2, type LatLon } from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { recordCarpoolTrips } from "@/lib/carpool-trips";
import { routeDrive } from "@/lib/routing";
import type { Json } from "@/lib/database.types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function revalidateDay(supabase: Supabase, eventId: string) {
  const { data: ev } = await supabase.from("events").select("group_id").eq("id", eventId).maybeSingle();
  revalidatePath("/admin/carpool");
  revalidatePath(`/events/${eventId}`);
  if (ev?.group_id) revalidatePath(`/groups/${ev.group_id}`);
  revalidatePath("/statistics");
}

/** Save one layout. `carpoolId` null creates it. A rider can only be in one layout
 * per day, so the save is refused if this layout claims someone a sibling already has. */
export async function saveCarpool(carpoolId: string | null, eventId: string, name: string, data: CarpoolDataV2, published: boolean): Promise<{ ok: true; id: string } | { error: string }> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  // Normalize-as-validation: whatever the client sent becomes a well-formed v2 sheet.
  const clean = upgradeCarpoolData(data, {});
  const label = name.trim() || "Carpool";

  const { data: siblings, error: sibErr } = await supabase.from("carpools").select("id, name, data, sort_order").eq("event_id", eventId).eq("org_id", org.id);
  if (sibErr) return { error: sibErr.message.includes("sort_order") ? "Run migration 0030_carpool_layouts.sql first" : sibErr.message };
  const mine = layoutMembers(clean);
  const clashes: { userId: string; layout: string }[] = [];
  for (const s of siblings ?? []) {
    if (s.id === carpoolId) continue;
    for (const id of layoutMembers(upgradeCarpoolData(s.data, {}))) if (mine.has(id)) clashes.push({ userId: id, layout: s.name });
  }
  if (clashes.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", clashes.map((c) => c.userId));
    const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
    return { error: `Already in another layout: ${clashes.map((c) => `${nameOf.get(c.userId) ?? "someone"} (“${c.layout}”)`).join(", ")}. Remove them there first.` };
  }

  let id = carpoolId;
  if (id) {
    const { error } = await supabase.from("carpools").update({ name: label, data: clean as unknown as Json, published }).eq("id", id).eq("org_id", org.id);
    if (error) return { error: error.message };
  } else {
    const sort_order = Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1;
    const { data: row, error } = await supabase.from("carpools")
      .insert({ org_id: org.id, event_id: eventId, name: label, sort_order, data: clean as unknown as Json, published }).select("id").single();
    if (error || !row) return { error: error?.message ?? "Couldn't create the layout." };
    id = row.id;
  }
  // Snapshot real route distances for the Statistics page — only on publish, since
  // it calls rate-limited routing servers (see lib/routing.ts).
  const savedId = id;
  if (published) after(() => recordCarpoolTrips(org.id, eventId, savedId, clean));
  await revalidateDay(supabase, eventId);
  return { ok: true, id: savedId };
}

/** "+ New layout" on a day: an empty, unpublished layout, opened straight away. */
export async function createCarpoolLayout(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const eventId = String(fd.get("event_id"));
  const { data: siblings } = await supabase.from("carpools").select("sort_order").eq("event_id", eventId).eq("org_id", org.id);
  const n = siblings?.length ?? 0;
  const { data: row, error } = await supabase.from("carpools").insert({
    org_id: org.id, event_id: eventId, name: n ? `Carpool ${n + 1}` : "Carpool",
    sort_order: Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1,
    data: upgradeCarpoolData({ v: 2 }, {}) as unknown as Json, published: false,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message.includes("sort_order") ? "Run migration 0030_carpool_layouts.sql first" : error?.message ?? "Couldn't create the layout.");
  await revalidateDay(supabase, eventId);
  redirect(`/admin/carpool?event=${eventId}&carpool=${row.id}`);
}

/** Delete one layout (its published mileage goes with it via the cascade). */
export async function deleteCarpoolLayout(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  const { data: row } = await supabase.from("carpools").select("event_id").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!row) return;
  await supabase.from("carpools").delete().eq("id", id).eq("org_id", org.id);
  await revalidateDay(supabase, row.event_id);
  redirect(`/admin/carpool?event=${row.event_id}`);
}

/** The builder map's route line for one car. Runs here rather than in the browser so
 * the routing fallbacks' API keys stay on the server. */
export async function routeCar(points: LatLon[]) {
  await requireAdmin();
  return routeDrive(points.slice(0, 50).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) })));
}
