import { getSession } from "@/lib/session";
import NavRail from "@/components/nav-rail";
import Icon from "@/components/icon";
import HeaderSearch from "@/components/header-search";
import NewEventButton from "@/components/new-event-button";
import UserMenu from "@/components/user-menu";
import DemoBanner from "@/components/demo-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, membership, isAdmin, demo } = await getSession();
  const initial = (profile.full_name || profile.email).trim().charAt(0).toUpperCase();
  return (
    <div className="min-h-screen flex flex-col">
      {demo && <DemoBanner hours={demo.hoursLeft} viewingAsMember={demo.viewingAsMember} />}
      {/* Top app bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-white px-4" style={{ borderColor: "var(--g-grey-300)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl" style={{ color: "var(--g-green)" }}><Icon name="dragon" /></span>
          <span className="truncate text-[22px] leading-none" style={{ color: "var(--g-grey-600)" }}>
            <span className="font-medium" style={{ color: "var(--g-grey-900)" }}>{membership?.organization.name ?? "Team"}</span> Portal
          </span>
        </div>
        <div className="hidden flex-1 px-4 sm:block"><HeaderSearch /></div>
        <div className="flex-1 sm:hidden" />
        {isAdmin && <NewEventButton />}
        <div className="hidden sm:block text-sm" style={{ color: "var(--g-grey-600)" }}>{demo ? (isAdmin ? "Demo Coach · admin" : "Viewing as a member") : <>{profile.email}{isAdmin && " · admin"}</>}</div>
        <UserMenu initial={initial} />
      </header>
      <div className="flex flex-1">
        {membership && <NavRail isAdmin={isAdmin} isDemo={!!demo} />}
        <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
