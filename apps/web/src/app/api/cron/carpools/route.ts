// Auto-carpool cron endpoint. Poked every 10 minutes by Supabase pg_cron
// (migration 0014). Finds forms whose due date has passed and generates a
// draft carpool for each linked event day — exactly once per form, tracked by
// forms.carpools_generated_at. Protected by the CRON_SECRET env var.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCarpoolForEvent, type GenerateResult } from "@/lib/carpool-auto";
import { pullGoogleCalendar } from "@/lib/google-calendar";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const { data: due, error } = await supabase
    .from("forms")
    .select("id, org_id, title")
    .in("status", ["open", "closed"])
    .not("due_at", "is", null)
    .lt("due_at", new Date().toISOString())
    .is("carpools_generated_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report: Record<string, Record<string, GenerateResult>> = {};
  for (const form of due ?? []) {
    // Claim before processing so overlapping runs can't double-generate.
    const { data: claimed } = await supabase
      .from("forms")
      .update({ carpools_generated_at: new Date().toISOString() })
      .eq("id", form.id)
      .is("carpools_generated_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const { data: fes } = await supabase.from("form_events").select("event_id").eq("form_id", form.id);
    const results: Record<string, GenerateResult> = {};
    for (const fe of fes ?? [])
      results[fe.event_id] = await generateCarpoolForEvent(supabase, form.org_id, fe.event_id);

    // If every event hit a hard error (not a skip), release the claim so the
    // next tick retries.
    const values = Object.values(results);
    if (values.length > 0 && values.every((r) => "error" in r))
      await supabase.from("forms").update({ carpools_generated_at: null }).eq("id", form.id);

    report[form.title] = results;
  }

  // Same 10-min tick also pulls Google Calendar edits back into the portal.
  const gcal: Record<string, unknown> = {};
  try {
    const { data: syncs } = await supabase.from("google_calendar_sync").select("org_id");
    for (const s of syncs ?? []) gcal[s.org_id] = await pullGoogleCalendar(s.org_id);
  } catch { /* table may not exist until migration 0023 runs */ }

  return NextResponse.json({ processed: Object.keys(report).length, report, gcal });
}
