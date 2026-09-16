"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type NotifState = { error?: string; ok?: boolean };

const on = (fd: FormData, name: string) => fd.get(name) === "on";

export async function setNotificationPrefs(_: NotifState, fd: FormData): Promise<NotifState> {
  const { org, userId } = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase.from("notification_prefs").upsert({
    user_id: userId, org_id: org.id,
    event_posted: on(fd, "event_posted"),
    deadline_reminder: on(fd, "deadline_reminder"),
    event_signup: on(fd, "event_signup"),
    form_submitted: on(fd, "form_submitted"),
    carpool_auto_generated: on(fd, "carpool_auto_generated"),
  }, { onConflict: "user_id,org_id" });
  if (error) return { error: error.message.includes("notification_prefs") ? "Run migration 0026_notifications.sql first" : error.message };
  revalidatePath("/notifications");
  return { ok: true };
}
