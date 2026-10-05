"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { upgradeCarpoolData, type CarpoolDataV2, type LatLon } from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { recordCarpoolTrips } from "@/lib/carpool-trips";
import { routeDrive } from "@/lib/routing";
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
  // it calls rate-limited routing servers (see lib/routing.ts).
  if (published) after(() => recordCarpoolTrips(org.id, eventId, clean));
  revalidatePath("/admin/carpool");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/statistics");
  return { ok: true };
}

/** The builder map's route line for one car. Runs here rather than in the browser so
 * the routing fallbacks' API keys stay on the server. */
export async function routeCar(points: LatLon[]) {
  await requireAdmin();
  return routeDrive(points.slice(0, 50).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) })));
}
