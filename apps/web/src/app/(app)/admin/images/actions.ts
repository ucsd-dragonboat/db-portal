"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

/** Delete images (file and record, via the Storage API). Only the team's own folder, plus
 * root-level files from before team folders that no other team uses (real teams only). */
export async function deleteImages(names: string[]): Promise<{ error?: string }> {
  const { org } = await requireAdmin();
  const admin = createAdminClient();
  const legacy = org.is_demo ? [] : ((await admin.rpc("legacy_images_for", { p_org: org.id })).data ?? []);
  const allowed = names.filter((n) => (n.startsWith(`${org.id}/`) && !n.slice(org.id.length + 1).includes("/")) || legacy.includes(n));
  if (allowed.length !== names.length) return { error: "Some of those images aren't your team's." };
  for (let i = 0; i < allowed.length; i += 100) {
    const { error } = await admin.storage.from("images").remove(allowed.slice(i, i + 100));
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/images");
  return {};
}

/** Adopt root-level images from before team folders: copy each into the team's folder,
 * point this team's content at the new path, then delete the old file. Files another
 * team's content uses are left alone. */
export async function moveLegacyImages(): Promise<{ moved: number; error?: string }> {
  const { org } = await requireAdmin();
  if (org.is_demo) return { moved: 0 };
  const admin = createAdminClient();
  const bucket = admin.storage.from("images");
  const { data: names, error } = await admin.rpc("legacy_images_for", { p_org: org.id });
  if (error) return { moved: 0, error: error.message };
  let moved = 0;
  for (const name of names ?? []) {
    const to = `${org.id}/${name}`;
    const copy = await bucket.copy(name, to);
    if (copy.error) return { moved, error: `${name}: ${copy.error.message}` };
    const rw = await admin.rpc("rewrite_image_path", { p_org: org.id, old_name: name, new_name: to });
    if (rw.error) return { moved, error: `${name}: ${rw.error.message}` };
    await bucket.remove([name]);
    moved++;
  }
  revalidatePath("/admin/images");
  return { moved };
}
