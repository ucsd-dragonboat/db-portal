"use client";

import { useState } from "react";
import { deletePickupLocation, deleteSavedLocation } from "../actions";
import type { PickupLocation, SavedLocation } from "@/lib/database.types";
import SavedLocationForm from "./saved-location-form";
import PickupForm from "./pickup-form";

const coords = (l: { lat: number | null; lon: number | null }) => (l.lat != null ? `(${l.lat.toFixed(4)}, ${l.lon?.toFixed(4)})` : null);

/** A list row with Edit / Delete on the right; Edit opens the form below, and Save closes it. */
function Row({ id, label, onDelete, editor }: { id: string; label: React.ReactNode; onDelete: (fd: FormData) => Promise<void>; editor: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-slate-600 underline">{open ? "Cancel" : "Edit"}</button>
          <form action={onDelete}><input type="hidden" name="id" value={id} /><button className="text-xs text-red-600 underline">Delete</button></form>
        </span>
      </div>
      {open && <div className="mt-2">{editor(() => setOpen(false))}</div>}
    </li>
  );
}

export function SavedLocationRow({ loc }: { loc: SavedLocation }) {
  return (
    <Row id={loc.id} onDelete={deleteSavedLocation} editor={(close) => <SavedLocationForm loc={loc} onSaved={close} />}
      label={<>{loc.name} <span className="text-xs text-slate-400">{[loc.address, loc.city, loc.zipcode].filter(Boolean).join(", ")}{coords(loc) ? ` ${coords(loc)}` : " · no coords"}</span></>} />
  );
}

export function PickupRow({ loc }: { loc: PickupLocation }) {
  return (
    <Row id={loc.id} onDelete={deletePickupLocation} editor={(close) => <PickupForm loc={loc} onSaved={close} />}
      label={<>{loc.name} <span className="text-xs text-slate-400">{coords(loc) ?? "no coords"}</span></>} />
  );
}
