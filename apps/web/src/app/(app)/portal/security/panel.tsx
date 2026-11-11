'use client';

import { useActionState, useState, useTransition } from 'react';
import { confirmEnrol, startEnrol, stepUp, type CodeState, type EnrolState, type ErrKey } from './actions';

export interface Labels {
  setUp: string; scan: string; orType: string; code: string; confirm: string; verify: string;
  err: Record<ErrKey, string>;
}

/** Strings arrive already localised from the server page (keeps the i18n bundle out of the client). */
export function EnrolPanel({ labels }: { labels: Labels }) {
  const [state, setState] = useState<EnrolState>({ step: 'idle' });
  const [pending, start] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState<CodeState, FormData>(confirmEnrol, {});
  const error = confirmState.error ?? state.error;
  return (
    <div className="card" style={{ maxWidth: '28rem', display: 'grid', gap: '1rem' }}>
      {state.step === 'idle' ? (
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setState(await startEnrol()))}>{labels.setUp}</button>
      ) : (
        <form action={confirmAction} style={{ display: 'grid', gap: '1rem' }}>
          <p>{labels.scan}</p>
          {/* the QR is an SVG data URI produced by Supabase Auth for this factor */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qr} alt="" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 12 }} />
          <p className="muted">{labels.orType} <code className="ltr">{state.secret}</code></p>
          <input type="hidden" name="factorId" value={state.factorId} />
          <label>{labels.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required dir="ltr" /></label>
          <button className="btn" disabled={confirming}>{labels.confirm}</button>
        </form>
      )}
      {error ? <p role="alert" style={{ color: 'var(--danger)' }}>{labels.err[error]}</p> : null}
    </div>
  );
}

export function StepUpForm({ labels, next }: { labels: Labels; next: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(stepUp, {});
  return (
    <form action={action} className="card" style={{ maxWidth: '24rem', display: 'grid', gap: '1rem' }}>
      <input type="hidden" name="next" value={next} />
      <label>{labels.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required dir="ltr" autoFocus /></label>
      {state.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{labels.err[state.error]}</p> : null}
      <button className="btn" disabled={pending}>{labels.verify}</button>
    </form>
  );
}
