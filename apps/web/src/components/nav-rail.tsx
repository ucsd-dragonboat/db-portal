"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "@/components/icon";

type NavItem = { href: string; label: string; icon: IconName; color: string };
const memberNav: NavItem[] = [
  { href: "/dashboard", label: "Board", icon: "board", color: "var(--g-yellow)" },
  { href: "/forms", label: "Forms", icon: "form", color: "var(--g-purple)" },
  { href: "/events", label: "Events", icon: "calendarCheck", color: "var(--g-green)" },
  { href: "/calendar", label: "Calendar", icon: "calendar", color: "var(--g-blue)" },
  { href: "/profile", label: "My profile", icon: "user", color: "var(--g-grey-600)" },
];
const adminNav: NavItem[] = [
  { href: "/admin/announcements", label: "Announcements", icon: "announce", color: "var(--g-yellow)" },
  { href: "/admin/forms", label: "Forms", icon: "file", color: "var(--g-purple)" },
  { href: "/admin/lineups", label: "Lineups", icon: "boat", color: "var(--g-blue)" },
  { href: "/admin/carpool", label: "Carpool", icon: "car", color: "var(--g-red)" },
  { href: "/admin/events", label: "Events", icon: "calendarCheck", color: "var(--g-green)" },
  { href: "/admin/members", label: "Members", icon: "users", color: "#009688" },
  { href: "/admin/settings", label: "Settings", icon: "gear", color: "var(--g-grey-600)" },
];

export default function NavRail({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const item = (n: NavItem) => {
    const active = path === n.href || path.startsWith(n.href + "/");
    return (
      <Link key={n.href} href={n.href} className={`nav-item ${active ? "nav-item-active" : ""}`}>
        <span className="w-5 text-center" style={{ color: n.color }}><Icon name={n.icon} /></span><span className="hidden md:inline">{n.label}</span>
      </Link>
    );
  };
  return (
    <aside className="w-14 md:w-60 shrink-0 py-3 pr-3 flex flex-col gap-0.5">
      {memberNav.map(item)}
      {isAdmin && (
        <>
          <div className="mt-4 mb-1 hidden md:block pl-6 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-grey-600)" }}>Admin</div>
          <div className="mt-4 md:hidden border-t mx-3" style={{ borderColor: "var(--g-grey-300)" }} />
          {adminNav.map(item)}
        </>
      )}
    </aside>
  );
}
