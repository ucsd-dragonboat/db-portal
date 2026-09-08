"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { regenerateCalendarToken } from "@/lib/calendar-token";
import { buildNominatimSearchUrl, parseNominatimResult } from "@db/carpool";

export type ProfileState = { error?: string; saved?: boolean; geocoded?: boolean };

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
const str = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

export async function saveProfile(_: ProfileState, formData: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: current } = await supabase.from("profiles").select("address, city, zipcode, lat, lon").eq("id", user.id).single();
  const address = str(formData.get("address")), city = str(formData.get("city")), zipcode = str(formData.get("zipcode"));
  let lat = current?.lat ?? null, lon = current?.lon ?? null, geocoded = false;
  const full = [address, city, zipcode].filter(Boolean).join(", ");
  const prevFull = [current?.address, current?.city, current?.zipcode].filter(Boolean).join(", ");

  // Geocode via Nominatim only when the address changed (free API, 1 req/s policy).
  if (address && full !== prevFull) {
    try {
      const res = await fetch(buildNominatimSearchUrl(full), {
        headers: { "User-Agent": "db-team-portal (contact via app admin)" },
      });
      const loc = parseNominatimResult(await res.json());
      if (loc) { lat = loc.lat; lon = loc.lon; geocoded = true; }
      else { lat = null; lon = null; }
    } catch { lat = null; lon = null; }
  } else if (!address) { lat = null; lon = null; }

  const { error } = await supabase.from("profiles").update({
    full_name: String(formData.get("full_name") ?? "").trim(),
    phone: str(formData.get("phone")),
    weight_lb: num(formData.get("weight_lb")),
    gender: (str(formData.get("gender")) as "male" | "female" | "other" | null),
    side_preference: (str(formData.get("side_preference")) as "left" | "right" | "either" | null),
    can_steer: formData.get("can_steer") === "on",
    can_drum: formData.get("can_drum") === "on",
    address, city, zipcode, lat, lon,
    car_passengers: num(formData.get("car_passengers")) ?? 0,
  }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/profile");
  return { saved: true, geocoded };
}

export type PasswordState = { error?: string; saved?: boolean };

/** Admins may set a password; once set, signing in with their email will ask for it. */
export async function setPassword(_: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { saved: true };
}

/** Invalidates the member's old iCal feed URL and issues a fresh one. */
export async function resetCalendarToken() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await regenerateCalendarToken(user.id);
  revalidatePath("/profile");
}
