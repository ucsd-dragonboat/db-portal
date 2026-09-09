"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/icon";
import ConfirmForm from "@/components/confirm-form";
import { deleteForm, duplicateForm } from "./actions";

/** ⋮ menu on a form or template card. Forms get Edit / Responses / Duplicate / Delete; templates just Edit / Delete. */
export default function FormMenu({ id, title, kind = "form", className = "absolute right-1 top-1 z-10" }: {
  id: string; title: string; kind?: "form" | "template"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const what = kind === "template" ? "template" : "form";
  return (
    <div ref={ref} className={className}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Options" aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 hover:bg-white" style={{ color: "var(--g-grey-600)" }}>
        <Icon name="dots" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border bg-white py-1 text-sm shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
          <Link href={`/admin/forms/${id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--g-grey-50)]"><Icon name="pen" /> Edit</Link>
          {kind === "form" && <>
            <Link href={`/admin/forms/${id}/responses`} className="flex items-center gap-2 px-4 py-2 hover:bg-[var(--g-grey-50)]"><Icon name="form" /> Responses</Link>
            <form action={duplicateForm}><input type="hidden" name="id" value={id} />
              <button className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-[var(--g-grey-50)]"><Icon name="clone" /> Duplicate</button></form>
          </>}
          <ConfirmForm action={deleteForm} message={`Delete ${what} “${title}”${kind === "form" ? " and all its responses" : ""}? This can’t be undone.`}>
            <input type="hidden" name="id" value={id} />
            <button className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-[var(--g-grey-50)]" style={{ color: "var(--g-red)" }}><Icon name="trash" /> Delete</button>
          </ConfirmForm>
        </div>
      )}
    </div>
  );
}
