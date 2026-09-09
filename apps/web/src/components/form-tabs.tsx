"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/icon";
import CopyButton from "@/components/copy-button";

/** Google Forms style "Questions | Responses" tab bar for the admin form editor, with a share-link button pinned right. */
export default function FormTabs({ id, responses, joinCode }: { id: string; responses?: number; joinCode: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/admin/forms/${id}`, label: "Questions" },
    { href: `/admin/forms/${id}/responses`, label: `Responses${responses != null ? ` ${responses}` : ""}` },
  ];
  return (
    <div className="relative flex justify-center gap-2 border-b bg-white -mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-4 px-4" style={{ borderColor: "var(--g-grey-300)" }}>
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link key={t.href} href={t.href} className="px-4 py-3 text-sm font-medium border-b-[3px] -mb-px transition"
            style={{ borderColor: active ? "var(--g-purple)" : "transparent", color: active ? "var(--g-purple)" : "var(--g-grey-600)" }}>
            {t.label}
          </Link>
        );
      })}
      <CopyButton text={() => `${location.origin}/f/${id}?join=${joinCode}`}
        className="btn-text absolute right-2 md:right-4 top-1/2 -translate-y-1/2"
        title="Copy a link anyone can open without signing in — they fill it out, enter their email, and are added to the team"
        label={<><Icon name="link" /> Copy link</>} copiedLabel={<><Icon name="check" /> Link copied</>} />
    </div>
  );
}
