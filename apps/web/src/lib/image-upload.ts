// Browser-only: image uploads to the team's folder in the public "images" bucket (migration 0036).
// Shared by the rich editor and the admin Images panel.

import { createClient } from "@/lib/supabase/client";

/** Image storage each team allows itself (well inside Supabase's 1 GB free tier);
 * demo sandboxes get a sliver. Files live under <org_id>/ (migration 0036). */
export const TEAM_CAP = 200 * 1024 * 1024;
export const DEMO_CAP = 10 * 1024 * 1024;
const MAX_PX = 1600;
const mb = (n: number) => (n / 1048576).toFixed(1);

/** If this upload would blow the team's cap, ask to evict its oldest images first (confirm-gated). */
async function ensureRoom(supabase: ReturnType<typeof createClient>, folder: string, cap: number, incoming: number) {
  const { data: files } = await supabase.storage.from("images").list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (!files?.length) return;
  const sized = files.map((f) => ({ name: `${folder}/${f.name}`, size: (f.metadata as { size?: number } | null)?.size ?? 0 }));
  let total = sized.reduce((a, f) => a + f.size, 0);
  if (total + incoming <= cap) return;
  const used = total;
  const doomed: string[] = [];
  for (const f of sized) {
    if (total + incoming <= cap) break;
    doomed.push(f.name); total -= f.size;
  }
  const ok = window.confirm(
    `Image storage is full (${mb(used)} of ${mb(cap)} MB used).\n` +
    `Delete the ${doomed.length} oldest image${doomed.length === 1 ? "" : "s"} to make room?\n` +
    `Old announcements/forms that still show them will lose those images.`);
  if (!ok) throw new Error("Upload canceled — image storage is full.");
  const { error } = await supabase.storage.from("images").remove(doomed);
  if (error) throw new Error(`Couldn’t free up space (ask an admin): ${error.message}`);
}

/** Shrinks photos before upload: longest side at most 1600 px, re-encoded as WebP.
 * Phone photos drop from several MB to a few hundred KB. GIFs (may be animated) and
 * anything that doesn't get smaller are uploaded as-is. */
async function compressImage(file: File): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.8));
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch { return file; }
}

/** Uploads an image to the team's folder in the public Supabase Storage bucket and returns its permanent URL. */
export async function uploadImage(original: File): Promise<string> {
  if (!original.type.startsWith("image/")) throw new Error("That file isn’t an image.");
  const file = await compressImage(original);
  if (file.size > 4 * 1024 * 1024) throw new Error("Image is over 4 MB — please resize it first.");
  const supabase = createClient();
  const { data: m } = await supabase.from("memberships").select("org_id, organization:organizations(is_demo)").order("created_at").limit(1).maybeSingle();
  if (!m) throw new Error("Sign in to attach images.");
  const isDemo = !!(m.organization as unknown as { is_demo: boolean } | null)?.is_demo;
  const ext = file.type === "image/webp" ? "webp" : (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${m.org_id}/${crypto.randomUUID()}.${ext}`;
  await ensureRoom(supabase, m.org_id, isDemo ? DEMO_CAP : TEAM_CAP, file.size);
  const { error } = await supabase.storage.from("images").upload(path, file, { contentType: file.type });
  if (error) throw new Error(/not authenticated|jwt|denied|security/i.test(error.message) ? "Sign in to attach images." : error.message);
  return supabase.storage.from("images").getPublicUrl(path).data.publicUrl;
}
