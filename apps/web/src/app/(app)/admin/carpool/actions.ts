"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { upgradeCarpoolData, type CarpoolDataV2 } from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { recordCarpoolTrips } from "@/lib/carpool-trips";
import type { Json } from "@/lib/database.types";

export async function saveCarpool(eventId: string, data: CarpoolDataV2, published: boolean) {
  const { org } = await requireAdmin();
  const supabase = await createClient();
  // Normalize-as-validation: whatever the client sent becomes a well-formed v2 sheet.
  const clean = upgradeCarpoolData(data, {});
  const { error } = await supabase.from("carpools").upsert(
    { org_id: org.id, event_id: eventId, data: clean as unknown as Json, published },
    { onConflict: "event_id" },
  );
  if (error) return { error: error.message };
  // Snapshot real route distances for the Statistics page — only on publish, since
  // it calls the rate-limited OSRM routing server (see lib/carpool-trips.ts).
  if (published) after(() => recordCarpoolTrips(org.id, eventId, clean));
  revalidatePath("/admin/carpool");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/statistics");
  return { ok: true };
}
