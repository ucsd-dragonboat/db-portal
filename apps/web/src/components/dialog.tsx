"use client";

import { useEffect } from "react";
import Icon from "@/components/icon";

/** Shared modal chrome: dark overlay, white card, title + X header; backdrop click and Escape close. */
export default function Dialog({ title, onClose, children, maxW = "max-w-lg", top = "pt-24" }: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode; maxW?: string; top?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 ${top}`} onClick={onClose}>
      <div className={`w-full ${maxW} rounded-lg bg-white p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-text"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
