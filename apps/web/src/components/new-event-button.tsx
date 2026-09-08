"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/icon";
import EventBatchForm from "@/components/event-batch-form";

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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-medium">New event</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn-text"><Icon name="x" /></button>
            </div>
            <p className="mb-3 text-sm" style={{ color: "var(--g-grey-600)" }}>
              An event is the container (e.g. “Spring Week 8 Practice”); pick its days and type the times.
              {folderId && " It will be filed into the folder you have open."}
            </p>
            <EventBatchForm key={initialDates.join(",") || "blank"} folderId={folderId} initialDates={initialDates}
              onCreated={() => { setOpen(false); router.refresh(); }} />
          </div>
        </div>
      )}
    </>
  );
}
