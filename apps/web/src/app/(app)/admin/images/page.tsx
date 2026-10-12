import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_CAP, TEAM_CAP } from "@/lib/image-upload";
import ImagesPanel from "./images-panel";

export default async function AdminImagesPage() {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  // Runs as the signed-in admin, so the SQL function's admin check applies (migration 0039).
  const { data, error } = await supabase.rpc("team_images", { p_org: org.id });
  // Root-level files another team uses are theirs: don't list them here.
  const adoptable = org.is_demo ? [] : ((await createAdminClient().rpc("legacy_images_for", { p_org: org.id })).data ?? []);
  const images = (data ?? []).filter((i) => !i.legacy || adoptable.includes(i.name));
  const base = supabase.storage.from("images").getPublicUrl("").data.publicUrl.replace(/\/$/, "");
  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Images</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>
          Every image uploaded to announcements, forms, events and form answers. Unused images older than 3 days are deleted automatically each night.
        </p>
      </div>
      {error ? (
        <div className="card py-3 text-sm text-amber-700">Run <code>supabase/migrations/0039_image_library.sql</code> in Supabase to turn on this page.</div>
      ) : (
        <ImagesPanel images={images} base={base} cap={org.is_demo ? DEMO_CAP : TEAM_CAP} />
      )}
    </div>
  );
}
