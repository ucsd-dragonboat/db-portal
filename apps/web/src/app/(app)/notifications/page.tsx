import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { NotificationPrefs } from "@/lib/database.types";
import NotificationPrefsForm from "./form";

export default async function NotificationsPage() {
  const { org, userId, isAdmin } = await requireOrg();
  const supabase = await createClient();
  const { data } = await supabase.from("notification_prefs").select("*").eq("user_id", userId).eq("org_id", org.id).maybeSingle();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Notification settings</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>Choose which emails you&apos;d like from the portal.</p>
      </div>
      <NotificationPrefsForm prefs={data as NotificationPrefs | null} isAdmin={isAdmin} />
    </div>
  );
}
