"use client";

import { useActionState } from "react";
import Icon from "@/components/icon";
import { saveProfile, type ProfileState } from "./actions";
import type { Profile } from "@/lib/database.types";
import { profileDefaultSpot } from "@/lib/campus-spots";

export default function ProfileForm({ profile: p, pickups }: { profile: Profile; pickups: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  return (
    <form action={action} className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-semibold">About you</h2>
        <div><label className="label">Full name</label><input name="full_name" defaultValue={p.full_name} required className="input" /></div>
        <div><label className="label">Phone</label><input name="phone" defaultValue={p.phone ?? ""} className="input" /></div>
        <div><label className="label">Birthday (the team calendar shows the month and day)</label><input name="birthday" type="date" required min="1900-01-01" defaultValue={p.birthday ?? ""} className="input w-48" /></div>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Paddling</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Weight (lb)</label><input name="weight_lb" type="number" step="0.1" min={60} max={450} defaultValue={p.weight_lb ?? ""} className="input" /></div>
          <div><label className="label">Gender (for boat category)</label>
            <select name="gender" defaultValue={p.gender ?? ""} className="input"><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
          <div><label className="label">Side preference</label>
            <select name="side_preference" defaultValue={p.side_preference ?? ""} className="input"><option value="">—</option><option value="left">Left</option><option value="right">Right</option><option value="either">Either</option></select></div>
        </div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="can_steer" defaultChecked={p.can_steer} /> Can steer</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="can_drum" defaultChecked={p.can_drum} /> Can drum</label>
        </div>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Carpool</h2>
        <div><label className="label">Home address (for pickup matching)</label>
          <input name="address" defaultValue={p.address ?? ""} placeholder="123 Main St" className="input" />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input name="city" defaultValue={p.city ?? ""} placeholder="City" className="input" />
            <input name="zipcode" defaultValue={p.zipcode ?? ""} placeholder="Zipcode" className="input" />
          </div>
          <p className="text-xs text-slate-500 mt-1">{p.lat ? <><Icon name="pin" /> Located ({p.lat.toFixed(3)}, {p.lon?.toFixed(3)})</> : "Not located yet"}</p></div>
        {pickups.length > 0 && (
          <div><label className="label">Default on-campus pickup spot (preselected when you need a ride)</label>
            <select name="default_spot" defaultValue={profileDefaultSpot(p) ?? ""} className="input">
              <option value="">None — I&apos;m off campus</option>
              {pickups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        )}
        <div className="text-sm">
          <label className="label">How many passengers can you drive? (not counting you — 0 if you don’t have a car)</label>
          <input name="car_passengers" type="number" min={0} max={14} defaultValue={p.car_passengers} className="input w-24" />
        </div>
      </section>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.saved && <p className="text-sm text-green-700">Saved{state.geocoded ? " — address located." : "."}</p>}
      <button disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}
