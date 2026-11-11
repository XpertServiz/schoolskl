'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { sendCode, signInWithPassword, verifyCode, type LoginState } from './actions';

/** Invisible to people (off-screen, not focusable, hidden from screen readers); bots that fill every field give themselves away. */
const Honeypot = () => (
  <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: '-9999px' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
);

/** Email + password sign-in (staff, vendor, and development). Error keys from the server action are mapped to the user's language here. */
export function PasswordLogin({ labels }: { labels: { email: string; password: string; signIn: string; errors: Record<string, string> } }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithPassword, { step: 'email' });
  return (
    <form action={action} className="form card">
      <label>{labels.email}<input name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <label>{labels.password}<input name="password" type="password" autoComplete="current-password" required dir="ltr" /></label>
      <Honeypot />
      {state.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{labels.errors[state.error] ?? state.error}</p> : null}
      <button className="btn" disabled={pending}>{labels.signIn}</button>
    </form>
  );
}

// Strings are passed in from the server page (already localised) so this client component stays free of the i18n bundle.
export function EmailCodeLogin({ labels }: { labels: { email: string; sendOtp: string; code: string; verify: string; sent: string; errors: Record<string, string> } }) {
  const [send, sendAction, sending] = useActionState<LoginState, FormData>(sendCode, { step: 'email' });
  const [verify, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCode, send);
  const onCode = send.step === 'code';
  const state = onCode ? verify : send;
  return (
    <form action={onCode ? verifyAction : sendAction} className="form card">
      {onCode ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{labels.sent}</p>
          <label>{labels.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6,8}" required dir="ltr" /></label>
        </>
      ) : (
        <><label>{labels.email}<input name="email" type="email" autoComplete="email" required dir="ltr" /></label><Honeypot /></>
      )}
      {state.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{labels.errors[state.error] ?? state.error}</p> : null}
      <button className="btn" disabled={sending || verifying}>{onCode ? labels.verify : labels.sendOtp}</button>
    </form>
  );
}

/**
 * The sign-in card: "Email code" / "Password" tabs, and a "New here?" panel. There is no open sign-up (DECISION: schools add people on
 * their Logins page, so a stranger can never create an account); an invited parent or teacher "activates" by signing in with an email
 * code, and a new school requests its account through the demo form.
 */
export function SignInCard({ code, password, labels }: {
  code: ReactNode; password: ReactNode;
  labels: { tabCode: string; tabPassword: string; newHere: string; activateBody: string; activate: string; newSchool: string; newSchoolBody: string; request: string; requestHref: string };
}) {
  const [tab, setTab] = useState<'code' | 'password'>('code');
  return (
    <>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>✉ {labels.tabCode}</button>
        <button type="button" role="tab" aria-selected={tab === 'password'} className={tab === 'password' ? 'on' : ''} onClick={() => setTab('password')}>🔑 {labels.tabPassword}</button>
      </div>
      {/* both panels are rendered (works before JavaScript loads); the inactive one is hidden */}
      <div role="tabpanel" hidden={tab !== 'code'}>{code}</div>
      <div role="tabpanel" hidden={tab !== 'password'}>{password}</div>
      <div className="newhere">
        <h2>{labels.newHere}</h2>
        <p className="muted">{labels.activateBody}</p>
        <button type="button" className="btn secondary" onClick={() => setTab('code')}>{labels.activate}</button>
        <p className="muted" style={{ marginTop: '.9rem' }}><b>{labels.newSchool}</b> {labels.newSchoolBody}</p>
        <a className="btn secondary" href={labels.requestHref}>{labels.request}</a>
      </div>
    </>
  );
}
