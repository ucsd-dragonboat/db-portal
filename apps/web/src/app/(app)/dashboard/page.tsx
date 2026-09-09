import Link from "next/link";
import Icon from "@/components/icon";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import RichText from "@/components/rich-text";

export default async function DashboardPage() {
  const { org, isAdmin, userId } = await requireOrg();
  const supabase = await createClient();
  const [{ data: announcements }, { data: events }, { data: openForms }] = await Promise.all([
    supabase.from("announcements").select("*, author:profiles(full_name)").eq("org_id", org.id)
      .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(10),
    supabase.from("events").select("*").eq("org_id", org.id)
      .gte("starts_at", new Date().toISOString()).order("starts_at").limit(5),
    supabase.from("forms").select("id, title, due_at, form_responses(user_id)").eq("org_id", org.id).eq("status", "open")
      .eq("form_responses.user_id", userId).order("due_at", { ascending: true, nullsFirst: false }),
  ]);
  const pendingForms = (openForms ?? []).filter((f) => !(f.form_responses as { user_id: string }[]).length);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-normal">Board</h1>
          {isAdmin && <Link href="/admin/announcements" className="btn-secondary">New announcement</Link>}
        </div>
        {pendingForms.length > 0 && (
          <div className="mb-4 rounded-lg border p-4 text-sm" style={{ borderColor: "#fde293", background: "#fef7e0" }}>
            <div className="font-semibold text-amber-800"><Icon name="form" /> You have {pendingForms.length} form{pendingForms.length > 1 ? "s" : ""} to fill out</div>
            <ul className="mt-1 space-y-0.5">
              {pendingForms.map((f) => <li key={f.id}><Link href={`/forms/${f.id}`} className="underline">{f.title}</Link>{f.due_at && <span className="text-amber-700"> · due <LocalTime iso={f.due_at} /></span>}</li>)}
            </ul>
          </div>
        )}
        {!announcements?.length && <p className="text-slate-500">No announcements yet.</p>}
        <div className="space-y-3">
          {announcements?.map((a) => (
            <article key={a.id} className="card">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">{a.pinned && <><Icon name="board" /> </>}{a.title}</h2>
                <span className="text-xs text-slate-400 whitespace-nowrap"><LocalTime iso={a.created_at} /></span>
              </div>
              <RichText text={a.body} className="mt-1 text-slate-700" />
              <p className="mt-2 text-xs text-slate-400">— {(a.author as { full_name: string } | null)?.full_name ?? "Admin"}</p>
            </article>
          ))}
        </div>
      </section>
      <aside>
        <h2 className="font-semibold mb-3">Upcoming events</h2>
        {!events?.length && <p className="text-sm text-slate-500">Nothing scheduled.</p>}
        <ul className="space-y-2">
          {events?.map((p) => (
            <li key={p.id}>
              <Link href={`/events/${p.id}`} className="card block hover:border-sky-400">
                <div className="font-medium text-sm">{p.title}</div>
                <div className="text-xs text-slate-500"><LocalTime iso={p.starts_at} />{p.location_name && ` · ${p.location_name}`}</div>
              </Link>
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="card mt-4 text-sm">
            <div className="text-xs text-slate-500">Team join code</div>
            <div className="font-mono text-lg tracking-wider">{org.join_code}</div>
            <p className="text-xs text-slate-500 mt-1">Share this with paddlers so they can join.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
