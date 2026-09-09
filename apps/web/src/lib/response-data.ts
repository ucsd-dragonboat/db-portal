import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Form, Profile, Rsvp } from "@/lib/database.types";
import type { GridEvent } from "@/lib/response-grid";

/** The queries feeding buildResponseGrid — shared by the admin Responses page
 * (RLS client) and the Sheets sync (admin client) so the grids can't diverge. */
export async function fetchResponseGridInput(supabase: SupabaseClient<Database>, form: Form) {
  const [{ data: links }, { data: responses }, { data: members }, { data: pickups }] = await Promise.all([
    supabase.from("form_events").select("*, event:events(id, title, starts_at)").eq("form_id", form.id).order("sort_order"),
    supabase.from("form_responses").select("*").eq("form_id", form.id),
    supabase.from("memberships").select("profile:profiles(*)").eq("org_id", form.org_id),
    supabase.from("pickup_locations").select("id, name").eq("org_id", form.org_id),
  ]);
  const events = (links ?? []).map((l) => l.event).filter(Boolean) as GridEvent[];
  const { data: rsvps } = events.length
    ? await supabase.from("rsvps").select("*").in("event_id", events.map((e) => e.id))
    : { data: [] as Rsvp[] };
  return {
    form,
    events,
    profiles: (members ?? []).map((m) => m.profile as unknown as Profile).filter(Boolean),
    responses: responses ?? [],
    rsvps: (rsvps ?? []) as Rsvp[],
    pickups: pickups ?? [],
  };
}
