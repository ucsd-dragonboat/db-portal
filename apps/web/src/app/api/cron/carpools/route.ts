// Auto-carpool cron endpoint. Poked by Supabase pg_cron (migration 0014) on 10-minute
// ticks that have work — public.cron_has_work(), migration 0041. Queues one job per linked day of each form whose due date has
// passed (once per form, tracked by forms.carpools_generated_at), then builds as
// many queued days as fit this tick (lib/carpool-queue.ts). Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueDueForms, processQueue } from "@/lib/carpool-queue";
import { removeDemoImages } from "@/lib/demo";
import { allowRate } from "@/lib/rate-limit";
import { pullGoogleCalendar, syncBirthdaysToGoogle } from "@/lib/google-calendar";
import { notifyEventDeadline, notifyFormDeadline } from "@/lib/notifications";

export const maxDuration = 60;

// Stop starting new carpool builds after this long, leaving the rest of the 60 s for
// the one in flight. Days not built yet wait for the next tick.
const CARPOOL_BUDGET_MS = 30_000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const queued = await enqueueDueForms(supabase);

  // Same 10-min tick also pulls Google Calendar edits back into the portal.
  const gcal: Record<string, unknown> = {};
  try {
    const { data: syncs } = await supabase.from("google_calendar_sync").select("org_id");
    for (const s of syncs ?? []) gcal[s.org_id] = { pull: await pullGoogleCalendar(s.org_id), birthdays: await syncBirthdaysToGoogle(s.org_id) };
  } catch (e) {
    // Expected until migration 0023 runs; after that it's a real failure, so log it.
    console.error("[cron] google calendar pull failed:", e);
  }

  // And "deadline in ~24h" reminders — each row is stamped once it's processed,
  // so a form/event whose deadline first enters the window gets exactly one email.
  let reminders = 0;
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: soonForms } = await supabase.from("forms").select("id, org_id, title, due_at")
      .in("status", ["open", "closed"]).not("due_at", "is", null).gte("due_at", now.toISOString()).lt("due_at", soon).is("deadline_reminder_sent_at", null);
    for (const f of soonForms ?? []) { await notifyFormDeadline(f); reminders++; }
    const { data: soonEvents } = await supabase.from("events").select("id, org_id, title, rsvp_deadline")
      .not("rsvp_deadline", "is", null).gte("rsvp_deadline", now.toISOString()).lt("rsvp_deadline", soon).is("deadline_reminder_sent_at", null);
    for (const e of soonEvents ?? []) { await notifyEventDeadline(e); reminders++; }
  } catch (e) {
    // Expected until migration 0026 runs; after that it's a real failure, so log it.
    console.error("[cron] deadline reminders failed:", e);
  }

  // And clears out expired demo sandboxes (migration 0032) — orgs + their fake users.
  const { data: expired } = await supabase.from("organizations").select("id").eq("is_demo", true).lt("demo_expires_at", new Date().toISOString());
  await removeDemoImages((expired ?? []).map((o) => o.id));
  const { data: demoCleaned } = await supabase.rpc("cleanup_demo_sandboxes", {});

  // Once a day, delete images nothing uses anymore (migration 0039). The 3-day grace
  // covers drafts and half-filled answers that haven't been saved yet.
  let imagesSwept = 0;
  if (await allowRate("image-sweep", 1, 86400)) {
    const { data: orphans, error } = await supabase.rpc("orphan_images", { min_age: "3 days" });
    if (error) console.error("[cron] image sweep:", error.message);
    for (let i = 0; i < (orphans ?? []).length; i += 100) {
      const batch = orphans!.slice(i, i + 100);
      const { error: rmErr } = await supabase.storage.from("images").remove(batch);
      if (rmErr) { console.error("[cron] image sweep remove:", rmErr.message); break; }
      imagesSwept += batch.length;
    }
  }
  // Carpool building goes last: if a slow build gets this call killed, the jobs above
  // have already run, and the build itself is re-queued by the next tick.
  const carpools = await processQueue(supabase, CARPOOL_BUDGET_MS);
  return NextResponse.json({ carpools: { ...queued, ...carpools }, gcal, reminders, demoCleaned, imagesSwept });
}
