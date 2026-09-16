"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/icon";
import { signOut } from "@/app/(auth)/actions";

/** Top-right profile avatar → dropdown (notification settings, sign out). Same
 * mechanics as admin/events/folder-menu.tsx's ⋮ menu. */
export default function UserMenu({ initial }: { initial: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full text-white font-medium" style={{ background: "var(--g-blue)" }}>
        {initial}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-52 rounded-lg border bg-white py-1 text-sm shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
            <Link href="/notifications" onClick={() => setOpen(false)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
              <Icon name="gear" /> Notification settings
            </Link>
            <div className="my-1 border-t" style={{ borderColor: "var(--g-grey-300)" }} />
            <form action={signOut}>
              <button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
