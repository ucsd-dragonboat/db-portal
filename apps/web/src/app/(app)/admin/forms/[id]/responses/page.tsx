import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import LocalTime from "@/components/local-time";
import Icon from "@/components/icon";
import type { Rsvp } from "@/lib/database.types";
import ExportCsv from "./export-csv";
import FormTabs from "@/components/form-tabs";
import { buildResponseGrid } from "@/lib/response-grid";
import { fetchResponseGridInput } from "@/lib/response-data";
import { getGoogleConnection, sheetViewUrl } from "@/lib/google-sheets";
import SheetsLink from "./sheets-link";

export default async function FormResponsesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ google?: string }> }) {
  const [{ id }, { google: googleReturn }] = await Promise.all([params, searchParams]);
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("*").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!form) notFound();
  const input = await fetchResponseGridInput(supabase, form); // same loader the Sheets sync uses
  const events = input.events;
  const rsvpBy = new Map<string, Rsvp>();
  for (const r of input.rsvps) rsvpBy.set(`${r.event_id}:${r.user_id}`, r);
  const { profiles, responded, missing, header, rows, lateFlags } = buildResponseGrid(input);
  const google = await getGoogleConnection(userId).catch(() => null); // null until migration 0022 runs

  return (
    <div className="gf-page -m-4 md:-m-6 min-h-full p-4 md:p-6">
      <FormTabs id={id} responses={responded.length} joinCode={org.join_code} />
      <div className="mx-auto max-w-[1100px] space-y-3">
      <div className="gf-header flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-normal">{responded.length} responses <span className="text-sm" style={{ color: "var(--g-grey-600)" }}>of {profiles.length} members</span></h1>
          <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>{form.title}{form.due_at && <> · due <LocalTime iso={form.due_at} /></>}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsv filename={`${form.title}.csv`} header={header} rows={rows.map((r) => r.map(String))} />
          <SheetsLink
            formId={id}
            connected={!!google}
            googleEmail={google?.googleEmail ?? null}
            linkedUrl={form.sheet_spreadsheet_id ? sheetViewUrl(form.sheet_spreadsheet_id, form.sheet_tab_id) : null}
            defaultUrl={google?.defaultSpreadsheetId ? sheetViewUrl(google.defaultSpreadsheetId, null) : null}
            autoOpen={!!googleReturn}
          />
        </div>
      </div>

      {events.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => {
            const rs = profiles.map((p) => rsvpBy.get(`${e.id}:${p.id}`)).filter(Boolean) as Rsvp[];
            const n = (f: (r: Rsvp) => boolean) => rs.filter(f).length;
            const seats = rs.filter((r) => r.ride === "driver").reduce((a, r) => a + (r.seats ?? 0), 0);
            return (
              <div key={e.id} className="gf-card !p-4 text-sm">
                <div className="font-medium"><Link href={`/events/${e.id}`} className="hover:underline">{e.title}</Link></div>
                <div className="text-xs text-slate-500"><LocalTime iso={e.starts_at} /></div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
                  <span><Icon name="yes" /> Yes: <b>{n((r) => r.status === "yes")}</b></span><span><Icon name="maybe" /> Maybe: {n((r) => r.status === "maybe")}</span>
                  <span><Icon name="no" /> No: {n((r) => r.status === "no")}</span><span><Icon name="hand" /> Need ride: <b>{n((r) => r.ride === "needs_ride")}</b></span>
                  <span><Icon name="crown" /> Drivers: {n((r) => r.ride === "driver")}</span><span><Icon name="seat" /> Seats: <b>{seats}</b></span>
                </div>
                <div className="mt-2 flex gap-3 text-xs"><Link href={`/admin/lineups?event=${e.id}`} className="underline">Lineups</Link><Link href={`/admin/carpool?event=${e.id}`} className="underline">Carpool</Link></div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sheet-wrap">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-green-soft)", color: "var(--g-green)" }}>
          <span className="font-medium">▦ Responses sheet</span><span style={{ color: "var(--g-grey-600)" }}>· one row per member, latest submission</span>
        </div>
        <table className="sheet">
          <thead><tr><th className="w-8 text-center">#</th>{header.map((h) => <th key={h} className="whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={lateFlags[i] ? { background: "#fce8e680" } : undefined}>
                <td className="text-center" style={{ background: "var(--g-grey-100)", color: "var(--g-grey-600)" }}>{i + 1}</td>
                {r.map((c, j) => <td key={j} className="max-w-[240px] whitespace-pre-wrap" style={j === r.length - 1 && c ? { color: c === "Late" ? "var(--g-red)" : "var(--g-green)", fontWeight: 500 } : undefined}>{String(c)}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={header.length + 1} className="p-3" style={{ color: "var(--g-grey-600)" }}>No responses yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="gf-card text-sm">
        <h3 className="font-medium mb-1">Haven’t responded ({missing.length})</h3>
        <p style={{ color: "var(--g-grey-600)" }}>{missing.length ? missing.map((p) => p.full_name || p.email).join(", ") : <>Everyone has responded <Icon name="party" /></>}</p>
      </div>
      </div>
    </div>
  );
}
