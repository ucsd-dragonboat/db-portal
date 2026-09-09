"use client";

import { useActionState } from "react";
import { signIn, type AuthState } from "../actions";

export default function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, { error: initialError });
  const grey = { color: "var(--g-grey-600)" };
  return (
    <form action={action} className="space-y-4">
      <p className="text-center text-base -mt-2 mb-6">Enter your email <span style={grey}>to continue</span></p>
      <input type="hidden" name="next" value={next} />
      {/* React 19 resets uncontrolled fields after each action, so on step 2 the email comes back via state as the defaultValue. */}
      <input key={state.step ? state.email : "email"} name="email" type="email" required placeholder="Email" className="input py-3" readOnly={!!state.step} defaultValue={state.email} />
      {state.step === "password" && <>
        <p className="text-sm" style={grey}>This account has a password — enter it to sign in.</p>
        <input name="password" type="password" required autoFocus placeholder="Password" className="input py-3" />
        {state.sent
          ? <p className="text-sm" style={{ color: "var(--g-green)" }}>Reset link sent — check your email (it expires in 30 minutes).</p>
          : <button name="intent" value="forgot" formNoValidate disabled={pending} className="btn-text -ml-3 text-sm">Forgot password?</button>}
      </>}
      {state.step === "name" && <>
        <p className="text-sm" style={grey}>Looks like you’re new here — what’s your name?</p>
        <input name="full_name" required autoFocus placeholder="Full name" className="input py-3" />
      </>}
      {state.error && <p className="text-sm" style={{ color: "var(--g-red)" }}>{state.error}</p>}
      <div className="flex items-center justify-between pt-2">
        {state.step ? <button type="button" onClick={() => location.reload()} className="btn-text -ml-3">Different email?</button> : <span />}
        <button disabled={pending} className="btn-primary">{pending ? "Signing in…" : "Next"}</button>
      </div>
    </form>
  );
}
