"use client";

import { useActionState } from "react";
import { addPickupFromSaved, type AdminState } from "../actions";
import type { SavedLocation } from "@/lib/database.types";

/** Pick one of the team's saved locations and add it as a pickup location. */
export default function PickupFromSaved({ options }: { options: Pick<SavedLocation, "id" | "name">[] }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(addPickupFromSaved, {});
  if (!options.length) return null;
  return (
    <form action={action} className="card mt-2 flex flex-wrap items-end gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <label className="label">Add from saved locations</label>
        <select name="saved_id" required defaultValue="" className="input">
          <option value="" disabled>Choose a saved location…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <button disabled={pending} className="btn-primary">Add</button>
      {state.error && <p className="w-full text-red-600">{state.error}</p>}
    </form>
  );
}
