import { getSession } from "@/lib/session";
import { getOrCreateCalendarToken } from "@/lib/calendar-token";
import ProfileForm from "./form";
import PasswordForm from "./password-form";
import CalendarFeed from "./calendar-feed";

export default async function ProfilePage() {
  const { profile, isAdmin, userId } = await getSession();
  const calendarToken = await getOrCreateCalendarToken(userId);
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-normal mb-1">My profile</h1>
      <p className="text-sm text-slate-500 mb-4">Weight and side preference feed the lineup builder; your address is only used for carpool matching (geocoded, never shown to other members).</p>
      <ProfileForm profile={profile} />
      <PasswordForm isAdmin={isAdmin} />
      <CalendarFeed token={calendarToken} />
    </div>
  );
}
