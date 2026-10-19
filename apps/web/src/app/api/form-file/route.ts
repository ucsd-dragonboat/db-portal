import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FORM_FILES_BUCKET, isFileAnswer } from "@/lib/form-files";

/**
 * Opens a file uploaded to a form (private bucket, migration 0042). Allowed for admins
 * of the team that owns it, and for the member whose own response holds it; everyone
 * else gets a 404. Redirects to a signed URL that expires in a minute.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("p") ?? "";
  const [orgId, formId] = path.split("/");
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!orgId || !formId || path.split("/").length !== 4) return notFound();

  const { data: claims } = await (await createClient()).auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`, req.url));

  const admin = createAdminClient();
  const [{ data: membership }, { data: own }] = await Promise.all([
    admin.from("memberships").select("role").eq("user_id", uid).eq("org_id", orgId).maybeSingle(),
    admin.from("form_responses").select("answers").eq("form_id", formId).eq("user_id", uid).maybeSingle(),
  ]);
  const mine = Object.values((own?.answers as Record<string, unknown> | null) ?? {}).filter(isFileAnswer).flat().some((f) => f.path === path);
  if (membership?.role !== "admin" && !mine) return notFound();

  // Served from Supabase's domain, so the browser shows images and PDFs inline and downloads the rest.
  const { data, error } = await admin.storage.from(FORM_FILES_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return notFound();
  return NextResponse.redirect(data.signedUrl);
}
