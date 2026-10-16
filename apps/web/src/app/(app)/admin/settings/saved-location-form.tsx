"use client";

import { useActionState, useEffect, useRef } from "react";
import { addSavedLocation, updateSavedLocation, type AdminState } from "../actions";
import type { SavedLocation } from "@/lib/database.types";

/** Adds a saved location, or edits `loc` when given (then calls onSaved). */
export default function SavedLocationForm({ loc, onSaved }: { onSaved?: () => void; loc?: SavedLocation }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(loc ? updateSavedLocation : addSavedLocation, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.ok) return;
    if (loc) onSaved?.(); else ref.current?.reset();
  }, [state, loc, onSaved]);
  return (
    <form ref={ref} action={action} className="card space-y-2 text-sm">
      {loc && <input type="hidden" name="id" value={loc.id} />}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div><label className="label">Name</label><input name="name" required placeholder="🛶 Mission Bay" defaultValue={loc?.name} className="input" /></div>
        <div><label className="label">Address</label><input name="address" placeholder="1750 Fiesta Island Rd" defaultValue={loc?.address ?? ""} className="input" /></div>
      </div>
      <div className="grid grid-cols-[1fr_90px_110px_110px_60px_auto] gap-2 items-end">
        <div><label className="label">City</label><input name="city" placeholder="San Diego" defaultValue={loc?.city ?? ""} className="input" /></div>
        <div><label className="label">Zip</label><input name="zipcode" defaultValue={loc?.zipcode ?? ""} className="input" /></div>
        <div><label className="label">Lat</label><input name="lat" type="number" step="any" defaultValue={loc?.lat ?? ""} className="input" /></div>
        <div><label className="label">Lon</label><input name="lon" type="number" step="any" defaultValue={loc?.lon ?? ""} className="input" /></div>
        <div><label className="label">Order</label><input name="sort_order" type="number" defaultValue={loc?.sort_order ?? 0} className="input" /></div>
        <button disabled={pending} className="btn-primary">{loc ? "Save" : "Add"}</button>
      </div>
      {state.error && <p className="text-red-600">{state.error}</p>}
    </form>
  );
}
