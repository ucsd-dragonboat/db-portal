// Who is attending a given event day.
//
// "Yes" only — a Maybe is not attending until they change their answer. Both the
// lineup builder and the carpool builder go through here so the two can never
// drift apart (same reason lib/riders.ts exists), and so they agree with the day
// cards, which have always counted yes only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/lib/database.types";

/** Attending profiles per event day, keyed by event id. Days with nobody attending are absent. */
export async function attendeesForDays(
  client: SupabaseClient<Database>,
  eventIds: string[],
): Promise<Map<string, Profile[]>> {
  const out = new Map<string, Profile[]>();
  if (!eventIds.length) return out;
  const { data } = await client
    .from("rsvps")
    .select("event_id, profile:profiles(*)")
    .in("event_id", eventIds)
    .eq("status", "yes");
  for (const r of (data ?? []) as unknown as { event_id: string; profile: Profile | null }[]) {
    if (!r.profile) continue;
    const list = out.get(r.event_id);
    if (list) list.push(r.profile);
    else out.set(r.event_id, [r.profile]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
  return out;
}

/** Just the user ids, for the common "is this person on for that day?" check. */
export async function attendeeIdsForDay(client: SupabaseClient<Database>, eventId: string): Promise<string[]> {
  const byDay = await attendeesForDays(client, [eventId]);
  return (byDay.get(eventId) ?? []).map((p) => p.id);
}
