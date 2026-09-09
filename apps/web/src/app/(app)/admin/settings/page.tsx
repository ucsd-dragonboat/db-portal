import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getGoogleConnection, sheetViewUrl } from "@/lib/google-sheets";
import { deletePickupLocation, deleteSavedLocation, disconnectGoogleAccount, rotateJoinCode } from "../actions";
import PickupForm from "./pickup-form";
import SavedLocationForm from "./saved-location-form";
import ConfirmForm from "@/components/confirm-form";

export default async function AdminSettingsPage() {
  const { org, userId } = await requireAdmin();
  const supabase = await createClient();
  const [{ data: pickups }, { data: locations }] = await Promise.all([
    supabase.from("pickup_locations").select("*").eq("org_id", org.id).order("sort_order").order("name"),
    supabase.from("saved_locations").select("*").eq("org_id", org.id).order("sort_order").order("name"),
  ]);
  const google = await getGoogleConnection(userId).catch(() => null); // null until migration 0022 runs
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-normal">Team settings</h1>
        <div className="text-sm text-slate-500">Team: <b>{org.name}</b> · join code <span className="font-mono">{org.join_code}</span>{" "}
          <ConfirmForm action={rotateJoinCode} className="inline" message="Rotate the join code? Anyone with the old code (or old shared form links) will no longer be auto-joined — current members are unaffected.">
            <button className="text-xs text-slate-500 underline">rotate</button>
          </ConfirmForm></div>
      </div>
      <section>
        <h2 className="text-lg font-medium mb-1">Saved locations</h2>
        <p className="text-sm text-slate-500 mb-3">Named places (with coordinates) that pop up as suggestions when creating events.</p>
        <SavedLocationForm />
        <ul className="mt-3 space-y-1">
          {locations?.map((l) => (
            <li key={l.id} className="card py-2 flex items-center justify-between text-sm">
              <span>{l.name} <span className="text-xs text-slate-400">{[l.address, l.city, l.zipcode].filter(Boolean).join(", ")}{l.lat != null ? ` (${l.lat.toFixed(4)}, ${l.lon?.toFixed(4)})` : " · no coords"}</span></span>
              <form action={deleteSavedLocation}><input type="hidden" name="id" value={l.id} /><button className="text-xs text-red-600 underline">Delete</button></form>
            </li>
          ))}
          {!locations?.length && <li className="text-sm text-slate-400">None yet.</li>}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-medium mb-1">Pickup locations</h2>
        <p className="text-sm text-slate-500 mb-3">Named meetup spots paddlers can pick when they need a ride (e.g. each campus college, “Peterson Loop”). Add lat/lon so the carpool map can route to them; otherwise the paddler’s home address is used.</p>
        <PickupForm />
        <ul className="mt-3 space-y-1">
          {pickups?.map((p) => (
            <li key={p.id} className="card py-2 flex items-center justify-between text-sm">
              <span>{p.name} <span className="text-xs text-slate-400">{p.lat != null ? `(${p.lat.toFixed(4)}, ${p.lon?.toFixed(4)})` : "no coords"}</span></span>
              <form action={deletePickupLocation}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-red-600 underline">Delete</button></form>
            </li>
          ))}
          {!pickups?.length && <li className="text-sm text-slate-400">None yet.</li>}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-medium mb-1">Google account</h2>
        <p className="text-sm text-slate-500 mb-3">Used to write form responses into Google Sheets (the “Link to Sheets” button on a form’s Responses page).</p>
        {google ? (
          <div className="card py-2 flex items-center justify-between text-sm">
            <span>
              Connected as <b>{google.googleEmail}</b>
              {google.defaultSpreadsheetId && <> · <a href={sheetViewUrl(google.defaultSpreadsheetId, null)} target="_blank" rel="noopener" className="underline">default spreadsheet</a></>}
            </span>
            <form action={disconnectGoogleAccount}><button className="text-xs text-red-600 underline" title="Forms already linked stop syncing">Disconnect</button></form>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Not connected — <a href="/api/google/connect?next=/admin/settings" className="underline">connect Google account</a>, or do it from any form’s Responses page.</p>
        )}
      </section>
    </div>
  );
}
