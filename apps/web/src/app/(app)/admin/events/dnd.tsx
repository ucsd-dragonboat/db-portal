"use client";

import { useState, useTransition } from "react";
import { moveFolderToFolder, moveGroupToFolder } from "../actions";

// Drag payloads are "group:<id>" or "folder:<id>" so folders can nest too.

/** Makes an event container draggable; carries its group id for folder drops. */
export function DraggableEvent({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", `group:${groupId}`); e.dataTransfer.effectAllowed = "move"; }}
      className="cursor-grab active:cursor-grabbing"
      title="Drag onto a folder to file this event"
    >
      {children}
    </div>
  );
}

/** Makes a folder row draggable (folders can be dropped into other folders). */
export function DraggableFolder({ folderId, children }: { folderId: string; children: React.ReactNode }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", `folder:${folderId}`); e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); }}
      className="cursor-grab active:cursor-grabbing"
      title="Drag onto another folder to nest it"
    >
      {children}
    </div>
  );
}

/** Drop zone that files the dragged event or folder into `folderId` (null = back to this level's parent/root). */
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
        const raw = e.dataTransfer.getData("text/plain");
        const [type, id] = raw.split(":");
        if (!id) return;
        const fd = new FormData();
        fd.set("folder_id", type === "folder" ? id : folderId ?? "");
        if (type === "group") {
          fd.set("group_id", id);
          start(() => moveGroupToFolder(fd));
        } else if (type === "folder" && id !== folderId) {
          fd.set("parent_id", folderId ?? "");
          start(() => moveFolderToFolder(fd));
        }
      }}
      className={`rounded-2xl transition ${over ? "ring-2 ring-[var(--g-blue)] bg-[var(--g-blue-tint)]" : ""} ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </div>
  );
}
