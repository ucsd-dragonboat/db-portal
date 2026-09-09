"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/icon";
import { deleteFolder, renameFolder, setFolderColor } from "../actions";

/** Google Drive's folder palette (subset). */
const COLORS = [
  "#795548", "#b0604c", "#d93025", "#f4511e", "#e8710a", "#f5b400",
  "#7cb342", "#0f9d58", "#009688", "#4285f4", "#7986cb", "#9c27b0",
  "#f06292", "#795c8a", "#9e9e9e", "#202124",
];

export default function FolderMenu({ id, name, color }: { id: string; name: string; color: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [pending, start] = useTransition();

  const act = (action: (fd: FormData) => Promise<void>, fields: Record<string, string>) =>
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      await action(fd);
      setOpen(false);
      setRenaming(false);
      router.refresh();
    });

  return (
    <div className="relative" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} draggable onDragStart={(e) => e.preventDefault()}>
      <button type="button" onClick={() => setOpen(!open)} title="More actions" aria-label="More actions"
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/10" style={{ color: "var(--g-grey-600)" }}>
        <Icon name="dots" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setRenaming(false); }} />
          <div className="absolute right-0 top-9 z-20 w-56 rounded-lg border bg-white py-1 text-sm shadow-lg" style={{ borderColor: "var(--g-grey-300)" }}>
            {renaming ? (
              <form className="flex items-center gap-1 px-2 py-1.5" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) act(renameFolder, { id, name: newName.trim() }); }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus className="input flex-1 py-1 text-xs" />
                <button disabled={pending} className="btn-primary py-1 text-xs">Save</button>
              </form>
            ) : (
              <button type="button" onClick={() => setRenaming(true)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                <Icon name="pen" /> Rename
              </button>
            )}
            <div className="my-1 border-t" style={{ borderColor: "var(--g-grey-300)" }} />
            <div className="px-4 py-1.5">
              <div className="mb-1.5 text-xs font-medium" style={{ color: "var(--g-grey-600)" }}>Folder color</div>
              <div className="grid grid-cols-8 gap-1.5">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => act(setFolderColor, { id, color: c })} aria-label={`Color ${c}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-white hover:scale-110" style={{ background: c }}>
                    {(color ?? "#5f6368") === c && <Icon name="check" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="my-1 border-t" style={{ borderColor: "var(--g-grey-300)" }} />
            <button type="button" disabled={pending}
              onClick={() => { if (confirm(`Delete folder "${name}"? Its events and subfolders are kept — they move back to All events.`)) act(deleteFolder, { id }); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50" style={{ color: "var(--g-red)" }}>
              <Icon name="trash" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
