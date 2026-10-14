"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/admin/carpool/jobs");
  revalidatePath("/admin/carpool");
}

/** Queue a failed or skipped auto-carpool day again (a fresh job, so its history stays). */
export async function retryJob(runId: string) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  const { data: run } = await supabase.from("carpool_runs").select("*").eq("id", runId).eq("org_id", org.id).maybeSingle();
  if (!run || run.trigger !== "cron" || (run.status !== "error" && run.status !== "skipped")) return;
  const { count } = await supabase.from("carpool_runs").select("id", { count: "exact", head: true })
    .eq("event_id", run.event_id).in("status", ["queued", "running"]);
  if (count) return; // that day is already waiting or building
  await supabase.from("carpool_runs").insert({ org_id: org.id, event_id: run.event_id, form_id: run.form_id, trigger: "cron", status: "queued" });
  refresh();
}

/** Take a queued day out of the queue. */
export async function cancelJob(runId: string) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  await supabase.from("carpool_runs").update({ status: "skipped", detail: "Canceled by an admin", finished_at: new Date().toISOString() })
    .eq("id", runId).eq("org_id", org.id).eq("status", "queued");
  refresh();
}
