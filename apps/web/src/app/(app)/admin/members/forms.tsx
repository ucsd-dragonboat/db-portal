"use client";

import { useActionState, useState } from "react";
import Icon from "@/components/icon";
import { addMember, importMembers, setMemberCap, updateMember, type AdminState } from "../actions";
import type { Profile } from "@/lib/database.types";

const FIELDS: { name: keyof Profile; label: string; type?: string; w?: string }[] = [
  { name: "full_name", label: "Name" }, { name: "email", label: "Email", type: "email" }, { name: "address", label: "Address", w: "w-64" },
  { name: "lat", label: "Latitude", type: "number" }, { name: "lon", label: "Longitude", type: "number" }, { name: "city", label: "City" }, { name: "zipcode", label: "Zipcode" },
];

export function AddMemberForm() {
  const [gen, setGen] = useState(0);
  return <AddInner key={gen} onDone={() => setGen((g) => g + 1)} />;
}
function AddInner({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<AdminState & { status?: string }, FormData>(async (p, fd) => { const r = await addMember(p, fd); if (r.ok) onDone(); return r; }, {});
  return (
    <form action={action} className="card space-y-2 text-sm">
      <h2 className="font-medium">Add a member</h2>
      <div className="grid grid-cols-2 gap-2">
        <input name="full_name" placeholder="Name" className="input" />
        <input name="email" type="email" required placeholder="Email *" className="input" />
        <input name="address" placeholder="Address" className="input col-span-2" />
        <input name="city" placeholder="City" className="input" />
        <input name="zipcode" placeholder="Zipcode" className="input" />
        <input name="lat" type="number" step="any" placeholder="Latitude" className="input" />
        <input name="lon" type="number" step="any" placeholder="Longitude" className="input" />
        <select name="gender" defaultValue="" className="input"><option value="">Gender</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>
        <input name="weight_lb" type="number" step="0.1" placeholder="W (lb)" className="input" />
        <input name="car_passengers" type="number" min={0} max={14} placeholder="Passengers they can drive (0 = no car)" className="input col-span-2" />
      </div>
      {state.error && <p style={{ color: "var(--g-red)" }}>{state.error}</p>}
      <button disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add member"}</button>
      <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>If this email already has an account they join instantly; otherwise they’re auto-joined (with these details) the moment they sign up.</p>
    </form>
  );
}

export function MemberCapForm({ cap, count }: { cap: number | null; count: number }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setMemberCap, {});
  const [enabled, setEnabled] = useState(cap != null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Cap team size
      </label>
      {enabled && <input name="cap" type="number" min={1} defaultValue={cap ?? Math.max(count, 1)} className="input w-20 py-0.5" />}
      <button disabled={pending} className="btn-text py-0.5 text-xs">{pending ? "Saving…" : "Save"}</button>
      {enabled && <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Join code stops working at the cap; members you add here aren’t blocked.</span>}
      {state.error && <span className="text-xs" style={{ color: "var(--g-red)" }}>{state.error}</span>}
      {state.ok && <span className="text-xs" style={{ color: "var(--g-green)" }}>Saved</span>}
    </form>
  );
}

export function ImportMembersForm() {
  const [state, action, pending] = useActionState<AdminState & { summary?: string }, FormData>(importMembers, {});
  return (
    <form action={action} className="card space-y-2 text-sm">
      <h2 className="font-medium">Import from a sheet</h2>
      <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>Copy the rows from Google Sheets (with the header row) and paste here. Columns: <span className="font-mono">Name Email Address Latitude Longitude City Zipcode Passengers Gender W(lb)</span> — any order, missing ones are fine, only Email is required.</p>
      <textarea name="csv" rows={6} placeholder={"Name\tEmail\tAddress\tLatitude\tLongitude\tCity\tZipcode\tPassengers\tGender\tW(lb)\nBrandon Lum\tbrandon@ucsd.edu\t123 Main St\t32.88\t-117.23\tSan Diego\t92093\t3\tM\t150"} className="input font-mono text-xs" />
      {state.error && <p style={{ color: "var(--g-red)" }}>{state.error}</p>}
      {state.summary && <p style={{ color: "var(--g-green)" }}>{state.summary}</p>}
      <button disabled={pending} className="btn-primary">{pending ? "Importing…" : "Import"}</button>
    </form>
  );
}

export function MemberRow({ index, profile: p, role, isSelf, roleForm, removeForm }: { index: number; profile: Profile; role: string; isSelf: boolean; roleForm: React.ReactNode; removeForm: React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  if (!edit) {
    return (
      <tr>
        <td className="gutter">{index}</td>
        <td className="font-medium whitespace-nowrap">{p.full_name || "—"}{isSelf && " (you)"}</td><td>{p.email}</td><td className="max-w-[220px]">{p.address ?? "—"}</td>
        <td>{p.lat ?? "—"}</td><td>{p.lon ?? "—"}</td><td>{p.city ?? "—"}</td><td>{p.zipcode ?? "—"}</td>
        <td>{p.car_passengers > 0 ? <><Icon name="car" /> {p.car_passengers}</> : "0"}</td><td className="capitalize">{p.gender ?? "—"}</td><td>{p.weight_lb ?? "—"}</td>
        <td>{roleForm}</td>
        <td className="whitespace-nowrap"><button type="button" onClick={() => setEdit(true)} className="btn-text py-0.5 text-xs" title="Edit"><Icon name="pen" /></button>{removeForm}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="gutter">{index}</td>
      <td colSpan={12} className="!p-2" style={{ background: "var(--g-blue-tint)" }}>
        <form action={updateMember} onSubmit={() => setEdit(false)} className="flex flex-wrap items-end gap-2 text-xs">
          <input type="hidden" name="user_id" value={p.id} />
          {FIELDS.filter((f) => f.name !== "email").map((f) => (
            <label key={f.name} className={f.w ?? "w-28"}><span className="label">{f.label}</span>
              <input name={f.name} type={f.type ?? "text"} step="any" defaultValue={(p[f.name] as string | number | null) ?? ""} className="input py-1" /></label>
          ))}
          <label className="w-24"><span className="label">Gender</span>
            <select name="gender" defaultValue={p.gender ?? ""} className="input py-1"><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          <label className="w-20"><span className="label">W (lb)</span><input name="weight_lb" type="number" step="0.1" defaultValue={p.weight_lb ?? ""} className="input py-1" /></label>
          <label className="w-24"><span className="label">Passengers</span><input name="car_passengers" type="number" min={0} max={14} defaultValue={p.car_passengers} className="input py-1" /></label>
          <span className="w-full text-[11px]" style={{ color: "var(--g-grey-600)" }}>{p.email} · role: {role}</span>
          <button className="btn-primary py-1">Save</button>
          <button type="button" onClick={() => setEdit(false)} className="btn-text py-1">Cancel</button>
        </form>
      </td>
    </tr>
  );
}
