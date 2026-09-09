"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/icon";
import Dialog from "@/components/dialog";

// Lazy: keeps tiptap + the date picker out of the shared layout bundle — the chunk
// only downloads when an admin actually opens the New-event dialog.
const EventBatchForm = dynamic(() => import("@/components/event-batch-form"), {
  loading: () => <p className="py-8 text-center text-sm" style={{ color: "var(--g-grey-600)" }}>Loading…</p>,
});

/**
 * ➕ in the top app bar (Docs-style), shown on the admin Events page and the
 * calendar. Opens the New-event dialog — also opened by clicking a day square
 * on the calendar (a "portal-new-event" window event carrying the date).
 */
export default function NewEventButton() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const path = usePathname();
  const router = useRouter();
  const folderId = useSearchParams().get("folder");
  const [open, setOpen] = useState(false);
  const [initialDates, setInitialDates] = useState<string[]>([]);

  useEffect(() => {
    const onDayClick = (e: Event) => {
      const date = (e as CustomEvent<{ date?: string }>).detail?.date;
      setInitialDates(date ? [date] : []);
      setOpen(true);
    };
    window.addEventListener("portal-new-event", onDayClick);
    return () => window.removeEventListener("portal-new-event", onDayClick);
  }, []);

  if (path !== "/admin/events" && path !== "/calendar") return null;
  return (
    <>
      <button type="button" onClick={() => { setInitialDates([]); setOpen(true); }} title="New event" aria-label="New event"
        className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:shadow-md"
        style={{ background: "var(--g-blue-tint)", color: "var(--g-blue)" }}>
        <Icon name="plus" />
      </button>
      {open && (
        <Dialog title="New event" onClose={() => setOpen(false)} maxW="max-w-2xl" top="pt-12">
          <p className="mb-3 text-sm" style={{ color: "var(--g-grey-600)" }}>
            An event is the container (e.g. “Spring Week 8 Practice”); pick its days and type the times.
            {folderId && " It will be filed into the folder you have open."}
          </p>
          <EventBatchForm key={initialDates.join(",") || "blank"} folderId={folderId} initialDates={initialDates}
            onCreated={() => { setOpen(false); router.refresh(); }} />
        </Dialog>
      )}
    </>
  );
}
