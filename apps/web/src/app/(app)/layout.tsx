import { getSession } from "@/lib/session";
import { signOut } from "@/app/(auth)/actions";
import NavRail from "@/components/nav-rail";
import Icon from "@/components/icon";
import HeaderSearch from "@/components/header-search";
import NewEventButton from "@/components/new-event-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, membership, isAdmin } = await getSession();
  const initial = (profile.full_name || profile.email).trim().charAt(0).toUpperCase();
  return (
    <div className="min-h-screen flex flex-col">
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
        <div className="hidden sm:block text-sm" style={{ color: "var(--g-grey-600)" }}>{profile.email}{isAdmin && " · admin"}</div>
        <form action={signOut} title="Sign out">
          <button className="flex h-9 w-9 items-center justify-center rounded-full text-white font-medium" style={{ background: "var(--g-blue)" }} aria-label="Sign out">{initial}</button>
        </form>
      </header>
      <div className="flex flex-1">
        {membership && <NavRail isAdmin={isAdmin} />}
        <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
