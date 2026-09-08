"use client";

import { useState, useTransition } from "react";
import { moveGroupToFolder } from "../actions";

/** Makes an event container draggable; carries its group id for folder drops. */
export function DraggableEvent({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", groupId); e.dataTransfer.effectAllowed = "move"; }}
      className="cursor-grab active:cursor-grabbing"
      title="Drag onto a folder to file this event"
    >
      {children}
    </div>
  );
}

/** Drop zone that files the dragged event into `folderId` (null = back to All events). */
export function FolderDropTarget({ folderId, children }: { folderId: string | null; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const gid = e.dataTransfer.getData("text/plain");
        if (!gid) return;
        const fd = new FormData();
        fd.set("group_id", gid);
        fd.set("folder_id", folderId ?? "");
        start(() => moveGroupToFolder(fd));
      }}
      className={`rounded-lg transition ${over ? "ring-2 ring-[var(--g-blue)] bg-[var(--g-blue-tint)]" : ""} ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </div>
  );
}
