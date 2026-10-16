"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPickupLocation, updatePickupLocation, type AdminState } from "../actions";
import type { PickupLocation } from "@/lib/database.types";

/** Adds a pickup location, or edits `loc` when given (then calls onSaved). */
export default function PickupForm({ loc, onSaved }: { onSaved?: () => void; loc?: PickupLocation }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(loc ? updatePickupLocation : addPickupLocation, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.ok) return;
    if (loc) onSaved?.(); else ref.current?.reset();
  }, [state, loc, onSaved]);
  return (
    <form ref={ref} action={action} className="card grid grid-cols-[1fr_110px_110px_60px_auto] gap-2 items-end text-sm">
      {loc && <input type="hidden" name="id" value={loc.id} />}
      <div><label className="label">Name</label><input name="name" required placeholder="Campus - Muir" defaultValue={loc?.name} className="input" /></div>
      <div><label className="label">Lat</label><input name="lat" type="number" step="any" defaultValue={loc?.lat ?? ""} className="input" /></div>
      <div><label className="label">Lon</label><input name="lon" type="number" step="any" defaultValue={loc?.lon ?? ""} className="input" /></div>
      <div><label className="label">Order</label><input name="sort_order" type="number" defaultValue={loc?.sort_order ?? 0} className="input" /></div>
      <button disabled={pending} className="btn-primary">{loc ? "Save" : "Add"}</button>
      {state.error && <p className="col-span-5 text-red-600">{state.error}</p>}
    </form>
  );
}
