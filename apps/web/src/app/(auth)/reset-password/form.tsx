"use client";

import { useActionState } from "react";
import { completeReset, type ResetState } from "../actions";

export default function ResetForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(completeReset, {});
  return (
    <form action={action} className="space-y-4">
      <p className="text-center text-base -mt-2 mb-6">Set a new password <span style={{ color: "var(--g-grey-600)" }}>for {email}</span></p>
      <input name="password" type="password" minLength={8} required autoFocus placeholder="New password (8+ characters)" className="input py-3" />
      {state.error && <p className="text-sm" style={{ color: "var(--g-red)" }}>{state.error}</p>}
      <div className="flex justify-end pt-2">
        <button disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save password"}</button>
      </div>
    </form>
  );
}
