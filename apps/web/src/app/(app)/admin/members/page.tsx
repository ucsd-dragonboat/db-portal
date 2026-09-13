import { requireAdmin } from "@/lib/session";
import Icon from "@/components/icon";
import { createClient } from "@/lib/supabase/server";
import { removeMember, removePending, setMemberRole } from "../actions";
import ConfirmForm from "@/components/confirm-form";
import type { Membership, PendingMember, Profile } from "@/lib/database.types";
import { AddMemberForm, ImportMembersForm, MemberCapForm, MemberRow } from "./forms";

export default async function AdminMembersPage() {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const [{ data }, { data: pending }] = await Promise.all([
    supabase.from("memberships").select("*, profile:profiles(*)").eq("org_id", org.id).order("created_at"),
    supabase.from("pending_members").select("*").eq("org_id", org.id).order("created_at"),
  ]);
  const members = ((data ?? []) as (Membership & { profile: Profile })[]).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
  const pend = (pending ?? []) as PendingMember[];
  const COLS = ["Name", "Email", "Address", "Latitude", "Longitude", "City", "Zipcode", "Passengers", "Gender", "W(lb)"];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Members <span style={{ color: "var(--g-grey-600)" }} className="font-normal">({members.length}{pend.length ? ` + ${pend.length} pending` : ""})</span></h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>Join code <span className="font-mono">{org.join_code}</span> — or add people below; they’re linked automatically when they sign up with that email.</p>
        <MemberCapForm cap={org.member_cap ?? null} count={members.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AddMemberForm />
        <ImportMembersForm />
      </div>

      <div className="sheet-wrap">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-green-soft)", color: "var(--g-green)" }}><span className="font-medium"><Icon name="table" /> Roster</span><span style={{ color: "var(--g-grey-600)" }}>· click <Icon name="pen" /> to edit a row</span></div>
        <table className="gsheet">
          <thead>
            <tr><th className="gutter" />{Array.from({ length: COLS.length + 2 }, (_, i) => <th key={i} className="gutter">{String.fromCharCode(65 + i)}</th>)}</tr>
            <tr className="labels"><th className="gutter w-8">#</th>{COLS.map((c) => <th key={c}>{c}</th>)}<th>Role</th><th></th></tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <MemberRow key={m.user_id} index={i + 1} profile={m.profile} role={m.role} isSelf={m.user_id === userId}
                roleForm={m.user_id !== userId ? (
                  <form action={setMemberRole} className="flex items-center gap-1">
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select name="role" defaultValue={m.role} className="input py-0.5 text-xs w-auto"><option value="member">member</option><option value="admin">admin</option></select>
                    <button className="btn-text py-0.5 text-xs">Set</button>
                  </form>
                ) : <span style={{ color: "var(--g-grey-600)" }}>{m.role} (you)</span>}
                removeForm={m.user_id !== userId ? (
                  <ConfirmForm action={removeMember} message={`Remove ${m.profile.full_name || m.profile.email} from the team?`}><input type="hidden" name="user_id" value={m.user_id} /><button className="btn-danger-text py-0.5 text-xs">Remove</button></ConfirmForm>
                ) : null}
              />
            ))}
            {pend.map((p, i) => (
              <tr key={p.email} className="pending" style={{ color: "var(--g-grey-600)" }}>
                <td className="gutter">{members.length + i + 1}</td>
                <td>{p.full_name || "—"}</td><td>{p.email}</td><td>{p.address ?? "—"}</td><td>{p.lat ?? "—"}</td><td>{p.lon ?? "—"}</td><td>{p.city ?? "—"}</td><td>{p.zipcode ?? "—"}</td>
                <td>{p.car_passengers}</td><td>{p.gender ?? "—"}</td><td>{p.weight_lb ?? "—"}</td>
                <td><span className="chip !py-0 text-[10px]" style={{ background: "#fef3c7", borderColor: "transparent", color: "#92400e" }}>pending sign-up</span></td>
                <td><ConfirmForm action={removePending} message={`Remove pending member ${p.email}?`}><input type="hidden" name="email" value={p.email} /><button className="btn-danger-text py-0.5 text-xs">Remove</button></ConfirmForm></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
