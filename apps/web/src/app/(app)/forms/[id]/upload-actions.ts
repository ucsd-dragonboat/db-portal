"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowRate, clientIp, RATE_LIMIT_MSG } from "@/lib/rate-limit";
import type { FormQuestion } from "@/lib/database.types";
import { DEMO_FILES_CAP, FORM_FILES_BUCKET, TEAM_FILES_CAP, fileAllowed, maxBytes, safeFileName } from "@/lib/form-files";

export type UploadTicket = { path: string; token: string } | { error: string };

/**
 * Hands out a one-time signed upload URL for one file on a File upload question. The
 * bucket is private (migration 0042), so this is the only way in: the form must be open,
 * the file must fit the question's rules and the team's cap, and the caller must be on
 * the team — or hold the team's join code, as on the shared /f/ link. Files nobody ends
 * up submitting are swept after 3 days (cron route).
 */
export async function startFormUpload(input: { formId: string; questionId: string; name: string; size: number; type: string; join?: string }): Promise<UploadTicket> {
  if (!(await allowRate(`fupload:${await clientIp()}`, 60, 3600))) return { error: RATE_LIMIT_MSG };
  const admin = createAdminClient();
  const { data: form } = await admin.from("forms").select("id, org_id, status, questions, organization:organizations(join_code, is_demo)").eq("id", input.formId).maybeSingle();
  const org = form?.organization as unknown as { join_code: string; is_demo: boolean } | null;
  if (!form || !org || form.status !== "open") return { error: "This form is not accepting responses." };

  // The join code covers the /f/ link and signed-in visitors joining through ?join=
  // (members only once they submit); otherwise the caller must already be on the team.
  const joinOk = !!input.join && input.join.trim().toUpperCase() === org.join_code;
  if (!joinOk) {
    const { data: claims } = await (await createClient()).auth.getClaims();
    const uid = claims?.claims.sub;
    const member = !!uid && !!(await admin.from("memberships").select("user_id").eq("user_id", uid).eq("org_id", form.org_id).maybeSingle()).data;
    if (!member) return { error: "Sign in to upload files." };
  }

  const q = ((form.questions as unknown as FormQuestion[]) ?? []).find((x) => x.id === input.questionId && x.type === "file_upload");
  if (!q) return { error: "This question no longer takes files — reload the form." };
  if (!(input.size > 0)) return { error: `“${input.name}” is empty.` };
  if (input.size > maxBytes(q)) return { error: `“${input.name}” is over ${maxBytes(q) / 1048576} MB.` };
  if (!fileAllowed(q.file_kinds, input.type, input.name)) return { error: `“${input.name}” isn’t an allowed file type.` };

  const { data: used } = await admin.rpc("form_files_bytes", { p_org: form.org_id });
  if ((used ?? 0) + input.size > (org.is_demo ? DEMO_FILES_CAP : TEAM_FILES_CAP))
    return { error: "The team’s file storage is full — ask an admin." };

  const path = `${form.org_id}/${form.id}/${crypto.randomUUID()}/${safeFileName(input.name)}`;
  const { data, error } = await admin.storage.from(FORM_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: /not found/i.test(error?.message ?? "") ? "Run migration 0042_form_files.sql first." : error?.message ?? "Couldn’t start the upload." };
  return { path, token: data.token };
}
