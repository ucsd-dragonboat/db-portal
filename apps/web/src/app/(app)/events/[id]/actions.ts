"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseAttendance } from "@/lib/attendance";
import { notifyEventSignup } from "@/lib/notifications";

export type RsvpState = { error?: string; saved?: boolean };

export async function submitRsvp(_: RsvpState, formData: FormData): Promise<RsvpState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const eventId = String(formData.get("event_id"));
  const values = parseAttendance(formData, "a_");
  if (!values) return { error: "Please pick an option" };
  const { error } = await supabase.from("rsvps").upsert({ event_id: eventId, user_id: user.id, ...values });
  if (error) return { error: error.message };
  after(() => notifyEventSignup(eventId, user.id, values.status, values.ride));
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { saved: true };
}
