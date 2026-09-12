"use server";

import { revalidatePath } from "next/cache";
import { upgradeCarpoolData, type CarpoolDataV2 } from "@db/carpool";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
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
  revalidatePath("/admin/carpool");
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}
