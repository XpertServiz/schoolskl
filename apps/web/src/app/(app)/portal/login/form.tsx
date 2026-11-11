'use client';

import { useActionState } from 'react';
import { sendCode, signInWithPassword, verifyCode, type LoginState } from './actions';

/** Email + password sign-in (staff, vendor, and development). Error keys from the server action are mapped to the user's language here. */
export function PasswordLogin({ labels }: { labels: { email: string; password: string; signIn: string; errors: Record<string, string> } }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithPassword, { step: 'phone' });
  return (
    <form action={action} className="form card">
      <label>{labels.email}<input name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <label>{labels.password}<input name="password" type="password" autoComplete="current-password" required dir="ltr" /></label>
      {state.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{labels.errors[state.error] ?? state.error}</p> : null}
      <button className="btn" disabled={pending}>{labels.signIn}</button>
    </form>
  );
}

// Strings are passed in from the server page (already localised) so this client component stays free of the i18n bundle.
export function PhoneLogin({ labels }: { labels: { phone: string; sendOtp: string; code: string; verify: string } }) {
  const [send, sendAction, sending] = useActionState<LoginState, FormData>(sendCode, { step: 'phone' });
  const [verify, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCode, send);
  const onCode = send.step === 'code';
  const state = onCode ? verify : send;
  return (
    <form action={onCode ? verifyAction : sendAction} className="form card">
      {onCode ? (
        <label>{labels.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required dir="ltr" /></label>
      ) : (
        <label>{labels.phone}<input name="phone" type="tel" autoComplete="tel" required dir="ltr" placeholder="0300 1234567" /></label>
      )}
      {state.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{state.error}</p> : null}
      <button className="btn" disabled={sending || verifying}>{onCode ? labels.verify : labels.sendOtp}</button>
    </form>
  );
}
