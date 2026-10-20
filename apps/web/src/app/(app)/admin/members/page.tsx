import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Membership, PendingMember, Profile } from "@/lib/database.types";
import { AddMemberForm, ImportMembersForm, MemberCapForm } from "./forms";
import MembersSheet, { type RosterRow } from "./members-sheet";

export default async function AdminMembersPage() {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const [{ data }, { data: pending }] = await Promise.all([
    supabase.from("memberships").select("*, profile:profiles(*)").eq("org_id", org.id).order("created_at"),
    supabase.from("pending_members").select("*").eq("org_id", org.id).order("created_at"),
  ]);
  const members = ((data ?? []) as (Membership & { profile: Profile })[]).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
  const pend = (pending ?? []) as PendingMember[];

  // Members first (by name), then pending sign-ups — the table's default order.
  const rows: RosterRow[] = [
    ...members.map((m): RosterRow => ({
      kind: "member", id: m.user_id, full_name: m.profile.full_name, email: m.profile.email, address: m.profile.address,
      lat: m.profile.lat, lon: m.profile.lon, city: m.profile.city, zipcode: m.profile.zipcode, car_passengers: m.profile.car_passengers,
      gender: m.profile.gender, weight_lb: m.profile.weight_lb, birthday: m.profile.birthday, role: m.role, isSelf: m.user_id === userId, profile: m.profile,
    })),
    ...pend.map((p): RosterRow => ({
      kind: "pending", id: `pending:${p.email}`, full_name: p.full_name, email: p.email, address: p.address,
      lat: p.lat, lon: p.lon, city: p.city, zipcode: p.zipcode, car_passengers: p.car_passengers,
      gender: p.gender, weight_lb: p.weight_lb, birthday: null, role: "pending", isSelf: false, profile: null,
    })),
  ];

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

      <MembersSheet rows={rows} orgId={org.id} />
    </div>
  );
}
