"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { cleanHtml } from "@/lib/html";

export type AdminState = { error?: string; ok?: boolean };

/** Retires a leaked/overshared join code — old links keep opening forms but stop auto-joining. */
export async function rotateJoinCode() {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("rotate_join_code", { org: org.id });
  revalidatePath("/admin/settings");
}
const str = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

export async function createAnnouncement(_: AdminState, fd: FormData): Promise<AdminState> {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    org_id: org.id, author_id: userId,
    title: String(fd.get("title")).trim(), body: cleanHtml(String(fd.get("body") ?? "")),
    pinned: fd.get("pinned") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard"); revalidatePath("/admin/announcements");
  return { ok: true };
}

export async function deleteAnnouncement(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("announcements").delete().eq("id", String(fd.get("id")));
  revalidatePath("/dashboard"); revalidatePath("/admin/announcements");
}

export async function togglePin(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("announcements").update({ pinned: fd.get("pinned") === "true" }).eq("id", String(fd.get("id")));
  revalidatePath("/dashboard"); revalidatePath("/admin/announcements");
}

export async function deleteEvent(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  const { data: ev } = await supabase.from("events").select("group_id").eq("id", id).eq("org_id", org.id).maybeSingle();
  await supabase.from("events").delete().eq("id", id).eq("org_id", org.id);
  revalidatePath("/events"); revalidatePath("/dashboard"); revalidatePath("/admin/events");
  if (ev?.group_id) revalidatePath(`/groups/${ev.group_id}`);
  const back = String(fd.get("redirect") ?? "");
  if (back) redirect(back);
}

export async function setMemberRole(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const target = String(fd.get("user_id"));
  if (target === userId) return; // don't demote yourself
  const supabase = await createClient();
  await supabase.from("memberships").update({ role: String(fd.get("role")) as "admin" | "member" })
    .eq("org_id", org.id).eq("user_id", target);
  revalidatePath("/admin/members");
}

export async function removeMember(fd: FormData) {
  const { org, userId } = await requireAdmin();
  const target = String(fd.get("user_id"));
  if (target === userId) return;
  const supabase = await createClient();
  await supabase.from("memberships").delete().eq("org_id", org.id).eq("user_id", target);
  revalidatePath("/admin/members");
}

export async function addPickupLocation(_: AdminState, fd: FormData): Promise<AdminState> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };
  const lat = str(fd.get("lat")), lon = str(fd.get("lon"));
  const { error } = await supabase.from("pickup_locations").insert({
    org_id: org.id, name, lat: lat ? Number(lat) : null, lon: lon ? Number(lon) : null,
    sort_order: Number(fd.get("sort_order") ?? 0) || 0,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function deletePickupLocation(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("pickup_locations").delete().eq("id", String(fd.get("id")));
  revalidatePath("/admin/settings");
}

export async function addSavedLocation(_: AdminState, fd: FormData): Promise<AdminState> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };
  const lat = str(fd.get("lat")), lon = str(fd.get("lon"));
  const { error } = await supabase.from("saved_locations").insert({
    org_id: org.id, name,
    address: str(fd.get("address")), city: str(fd.get("city")), zipcode: str(fd.get("zipcode")),
    lat: lat ? Number(lat) : null, lon: lon ? Number(lon) : null,
    sort_order: Number(fd.get("sort_order") ?? 0) || 0,
  });
  if (error) return { error: error.message.includes("duplicate") ? "A saved location with that name already exists." : error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function deleteSavedLocation(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("saved_locations").delete().eq("id", String(fd.get("id")));
  revalidatePath("/admin/settings");
}

/** Create one event per entry (used by the "add practice days" widget). Returns created ids in input order. */
export async function createEventsBatch(input: {
  kind: "practice" | "race" | "social" | "other";
  items: { title: string; starts_at: string; ends_at: string | null; rsvp_deadline: string | null }[];
  location_name: string | null; location_lat: number | null; location_lon: number | null; notes: string | null;
  /** When set, an event (group) wrapping all the days is created with this name. */
  groupName?: string | null;
  /** Or attach the new days to an existing group. */
  groupId?: string | null;
  /** Folder for a newly created group (Drive-style organization). */
  folderId?: string | null;
}): Promise<{ ids?: string[]; groupId?: string | null; error?: string }> {
  const { org, userId } = await requireAdmin();
  if (!input.items.length) return { error: "Add at least one date" };
  const supabase = await createClient();
  let groupId: string | null = input.groupId ?? null;
  if (!groupId && input.groupName) {
    const { data: g, error: ge } = await supabase.from("event_groups").insert({ org_id: org.id, name: input.groupName.trim(), kind: input.kind, folder_id: input.folderId ?? null, created_by: userId }).select("id").single();
    if (ge) return { error: ge.message };
    groupId = g.id;
  }
  const { data, error } = await supabase.from("events").insert(input.items.map((it) => ({
    org_id: org.id, created_by: userId, kind: input.kind, group_id: groupId, title: it.title, starts_at: it.starts_at, ends_at: it.ends_at, rsvp_deadline: it.rsvp_deadline,
    location_name: input.location_name, location_lat: input.location_lat, location_lon: input.location_lon, notes: input.notes ? cleanHtml(input.notes) : null,
  }))).select("id, starts_at");
  if (error) return { error: error.message };
  revalidatePath("/events"); revalidatePath("/dashboard"); revalidatePath("/admin/events");
  const order = new Map(input.items.map((it, i) => [it.starts_at, i]));
  revalidatePath("/groups", "layout");
  return { groupId, ids: (data ?? []).sort((a, b) => (order.get(new Date(a.starts_at).toISOString()) ?? 0) - (order.get(new Date(b.starts_at).toISOString()) ?? 0)).map((d) => d.id) };
}

/** Edit one day from the group overview: title, times, location, RSVP deadline, notes. */
export async function updateEventDay(input: {
  id: string; title: string; starts_at: string; ends_at: string | null; rsvp_deadline: string | null;
  location_name: string | null; location_lat: number | null; location_lon: number | null; notes: string | null;
}): Promise<AdminState> {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  if (!input.title.trim()) return { error: "Title is required" };
  const { data: ev, error } = await supabase.from("events").update({
    title: input.title.trim(), starts_at: input.starts_at, ends_at: input.ends_at, rsvp_deadline: input.rsvp_deadline,
    location_name: input.location_name, location_lat: input.location_lat, location_lon: input.location_lon,
    notes: input.notes ? cleanHtml(input.notes) : null,
  }).eq("id", input.id).eq("org_id", org.id).select("group_id").maybeSingle();
  if (error) return { error: error.message };
  revalidatePath("/events"); revalidatePath("/dashboard"); revalidatePath("/admin/events"); revalidatePath(`/events/${input.id}`);
  if (ev?.group_id) revalidatePath(`/groups/${ev.group_id}`);
  return { ok: true };
}

// ---------- Drive-style event folders ----------

export async function createFolder(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const name = String(fd.get("name") ?? "").trim();
  const parentId = String(fd.get("parent_id") ?? "") || null;
  if (name) await supabase.from("event_folders").insert({ org_id: org.id, name, parent_id: parentId });
  revalidatePath("/admin/events");
}

export async function renameFolder(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const name = String(fd.get("name") ?? "").trim();
  if (name) await supabase.from("event_folders").update({ name }).eq("id", String(fd.get("id"))).eq("org_id", org.id);
  revalidatePath("/admin/events");
}

/** Deleting a folder keeps its events — their folder_id resets via the FK. */
export async function deleteFolder(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  await supabase.from("event_folders").delete().eq("id", String(fd.get("id"))).eq("org_id", org.id);
  revalidatePath("/admin/events");
  redirect("/admin/events");
}

export async function moveGroupToFolder(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const folderId = String(fd.get("folder_id") ?? "");
  await supabase.from("event_groups").update({ folder_id: folderId || null }).eq("id", String(fd.get("group_id"))).eq("org_id", org.id);
  revalidatePath("/admin/events");
}

/** Re-parents a folder (Drive-style nesting). Refuses cycles: a folder can't move into itself or a descendant. */
export async function moveFolderToFolder(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const folderId = String(fd.get("folder_id"));
  const parentId = String(fd.get("parent_id") ?? "") || null;
  if (!folderId || folderId === parentId) return;
  if (parentId) {
    const { data: all } = await supabase.from("event_folders").select("id, parent_id").eq("org_id", org.id);
    const parentOf = new Map((all ?? []).map((f) => [f.id, f.parent_id]));
    for (let p: string | null = parentId; p; p = parentOf.get(p) ?? null) {
      if (p === folderId) return; // would create a cycle
    }
  }
  await supabase.from("event_folders").update({ parent_id: parentId }).eq("id", folderId).eq("org_id", org.id);
  revalidatePath("/admin/events");
}

export async function setFolderColor(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const color = String(fd.get("color") ?? "");
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return;
  await supabase.from("event_folders").update({ color: color || null }).eq("id", String(fd.get("id"))).eq("org_id", org.id);
  revalidatePath("/admin/events"); revalidatePath("/events");
}

export async function renameGroup(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const name = String(fd.get("name") ?? "").trim();
  if (name) await supabase.from("event_groups").update({ name }).eq("id", String(fd.get("id"))).eq("org_id", org.id);
  revalidatePath(`/groups/${String(fd.get("id"))}`); revalidatePath("/admin/events"); revalidatePath("/events");
}

export async function deleteGroup(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const id = String(fd.get("id"));
  if (fd.get("with_events") === "on") await supabase.from("events").delete().eq("group_id", id).eq("org_id", org.id);
  await supabase.from("event_groups").delete().eq("id", id).eq("org_id", org.id);
  revalidatePath("/admin/events"); revalidatePath("/events"); revalidatePath("/dashboard");
  redirect("/admin/events");
}

export type MemberInput = { email: string; full_name?: string; address?: string | null; city?: string | null; zipcode?: string | null; lat?: number | null; lon?: number | null; car_passengers?: number | null; gender?: "male" | "female" | "other" | null; weight_lb?: number | null };

async function addOne(orgId: string, m: MemberInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_add_member", {
    p_org: orgId, p_email: m.email, p_full_name: m.full_name ?? "", p_address: m.address ?? null, p_city: m.city ?? null, p_zipcode: m.zipcode ?? null,
    p_lat: m.lat ?? null, p_lon: m.lon ?? null, p_car_passengers: m.car_passengers ?? null, p_gender: m.gender ?? null, p_weight_lb: m.weight_lb ?? null,
  });
  return { status: data as string | null, error: error?.message };
}

const optNum = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s ? Number(s) : null; };
/** "Passengers" column: a number; also accepts legacy Yes/No (Yes → 3). */
const passengers = (v: string | undefined | null): number | null => {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (/^(y|yes|true|driver|drives)$/i.test(s)) return 3;
  if (/^(n|no|false)$/i.test(s)) return 0;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? Math.min(14, Math.max(0, n)) : null;
};
const normGender = (v: string | undefined | null): "male" | "female" | "other" | null => {
  const s = String(v ?? "").trim().toLowerCase(); if (!s) return null;
  if (s.startsWith("m")) return "male"; if (s.startsWith("f") || s.startsWith("w")) return "female"; return "other";
};

export async function addMember(_: AdminState, fd: FormData): Promise<AdminState & { status?: string }> {
  const { org } = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Email is required" };
  const g = str(fd.get("gender"));
  const r = await addOne(org.id, {
    email, full_name: String(fd.get("full_name") ?? "").trim(), address: str(fd.get("address")), city: str(fd.get("city")), zipcode: str(fd.get("zipcode")),
    lat: optNum(fd.get("lat")), lon: optNum(fd.get("lon")), car_passengers: optNum(fd.get("car_passengers")), gender: (g as "male" | "female" | "other" | null), weight_lb: optNum(fd.get("weight_lb")),
  });
  if (r.error) return { error: r.error };
  revalidatePath("/admin/members");
  return { ok: true, status: r.status ?? undefined };
}

/** Paste-a-sheet import. Header row with any of: Name, Email, Address, Latitude, Longitude, City, Zipcode, Drives, Gender, W(lb) / Weight. Tab or comma separated. */
export async function importMembers(_: AdminState, fd: FormData): Promise<AdminState & { summary?: string }> {
  const { org } = await requireAdmin();
  const text = String(fd.get("csv") ?? "").trim();
  if (!text) return { error: "Paste some rows first" };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) => sep === "\t" ? l.split("\t") : (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1);
  const header = split(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iEmail = col("email"), iName = col("name", "full name"), iAddr = col("address"), iLat = col("latitude", "lat"), iLon = col("longitude", "lon", "lng"),
    iCity = col("city"), iZip = col("zip"), iPass = col("passengers", "car passenger", "seats", "drives", "driver"), iGender = col("gender"), iW = col("w(lb)", "w (lb)", "weight", "w");
  if (iEmail < 0) return { error: 'Header must include an "Email" column' };
  let linked = 0, pending = 0, skipped = 0; const errors: string[] = [];
  for (const line of lines.slice(1)) {
    const c = split(line); const at = (i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
    const email = at(iEmail).toLowerCase(); if (!email.includes("@")) { skipped++; continue; }
    const r = await addOne(org.id, {
      email, full_name: at(iName), address: at(iAddr) || null, city: at(iCity) || null, zipcode: at(iZip) || null,
      lat: at(iLat) ? Number(at(iLat)) : null, lon: at(iLon) ? Number(at(iLon)) : null, car_passengers: passengers(at(iPass)), gender: normGender(at(iGender)),
      weight_lb: at(iW) ? Number(at(iW).replace(/[^0-9.]/g, "")) || null : null,
    });
    if (r.error) errors.push(`${email}: ${r.error}`); else if (r.status === "linked") linked++; else pending++;
  }
  revalidatePath("/admin/members");
  return { ok: true, summary: `${linked} linked to existing accounts, ${pending} added as pending${skipped ? `, ${skipped} skipped (no email)` : ""}${errors.length ? `. Errors: ${errors.join("; ")}` : ""}` };
}

export async function updateMember(fd: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const g = str(fd.get("gender"));
  await supabase.from("profiles").update({
    full_name: String(fd.get("full_name") ?? "").trim(), address: str(fd.get("address")), city: str(fd.get("city")), zipcode: str(fd.get("zipcode")),
    lat: optNum(fd.get("lat")), lon: optNum(fd.get("lon")), car_passengers: optNum(fd.get("car_passengers")) ?? 0, gender: (g as "male" | "female" | "other" | null), weight_lb: optNum(fd.get("weight_lb")),
  }).eq("id", String(fd.get("user_id")));
  revalidatePath("/admin/members");
}

export async function removePending(fd: FormData) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  await supabase.from("pending_members").delete().eq("org_id", org.id).eq("email", String(fd.get("email")));
  revalidatePath("/admin/members");
}
