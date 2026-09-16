"use client";

import { useActionState } from "react";
import { setNotificationPrefs, type NotifState } from "./actions";
import type { NotificationPrefs } from "@/lib/database.types";

type Field = { name: keyof NotificationPrefs; label: string };
const MEMBER_FIELDS: Field[] = [
  { name: "event_posted", label: "A new event is posted" },
  { name: "deadline_reminder", label: "A form or event RSVP deadline is 24 hours away" },
];
const ADMIN_FIELDS: Field[] = [
  { name: "event_signup", label: "Someone signs up (RSVPs) for an event" },
  { name: "form_submitted", label: "Someone submits a form" },
  { name: "carpool_auto_generated", label: "The auto-carpool job finishes for an event" },
];

export default function NotificationPrefsForm({ prefs, isAdmin }: { prefs: NotificationPrefs | null; isAdmin: boolean }) {
  const [state, action, pending] = useActionState<NotifState, FormData>(setNotificationPrefs, {});
  const checked = (name: keyof NotificationPrefs) => (prefs ? Boolean(prefs[name]) : false);
  const fields = isAdmin ? [...MEMBER_FIELDS, ...ADMIN_FIELDS] : MEMBER_FIELDS;
  return (
    <form action={action} className="card max-w-lg space-y-3 text-sm">
      <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>All off by default. Turn on the ones you want.</p>
      {fields.map((f) => (
        <label key={f.name} className="flex items-center gap-2">
          <input type="checkbox" name={f.name} defaultChecked={checked(f.name)} />
          {f.label}
        </label>
      ))}
      {state.error && <p style={{ color: "var(--g-red)" }}>{state.error}</p>}
      {state.ok && <p style={{ color: "var(--g-green)" }}>Saved</p>}
      <button disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
