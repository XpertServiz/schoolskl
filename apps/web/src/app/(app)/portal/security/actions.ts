'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

/** Errors are KEYS (security.err.*): the client panel maps them to the user's language, so no English text lives in server actions. */
export type ErrKey = 'start' | 'enterCode' | 'retry' | 'wrongCode' | 'noFactor';
export interface EnrolState { step: 'idle' | 'scan'; factorId?: string; qr?: string; secret?: string; error?: ErrKey }
export interface CodeState { error?: ErrKey }

const code = z.string().regex(/^\d{6}$/);

/** Start authenticator-app (TOTP) enrolment. The factor stays "unverified" — and useless — until the first correct code. */
export async function startEnrol(): Promise<EnrolState> {
  const sb = await supabaseServer();
  // clear a half-finished attempt so the user is never stuck behind an unverified factor
  const { data: existing } = await sb.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data) return { step: 'idle', error: 'start' };
  return { step: 'scan', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrol(_: CodeState, form: FormData): Promise<CodeState> {
  const c = code.safeParse(form.get('code'));
  const factorId = z.string().uuid().safeParse(form.get('factorId'));
  if (!c.success || !factorId.success) return { error: 'enterCode' };
  const sb = await supabaseServer();
  const ch = await sb.auth.mfa.challenge({ factorId: factorId.data });
  if (ch.error) return { error: 'retry' };
  const v = await sb.auth.mfa.verify({ factorId: factorId.data, challengeId: ch.data.id, code: c.data });
  if (v.error) return { error: 'wrongCode' };
  redirect('/portal/security?ok=1');
}

/** Step up an existing session from aal1 to aal2 (needed for money, payroll and admin actions). */
export async function stepUp(_: CodeState, form: FormData): Promise<CodeState> {
  const c = code.safeParse(form.get('code'));
  if (!c.success) return { error: 'enterCode' };
  const sb = await supabaseServer();
  const { data: f } = await sb.auth.mfa.listFactors();
  const factor = f?.totp?.[0]; // verified TOTP factors only
  if (!factor) return { error: 'noFactor' };
  const ch = await sb.auth.mfa.challenge({ factorId: factor.id });
  if (ch.error) return { error: 'retry' };
  const v = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: c.data });
  if (v.error) return { error: 'wrongCode' };
  redirect(safeNext(String(form.get('next') ?? '')));
}

/** Only same-site /portal paths: never an open redirect. */
function safeNext(n: string): string {
  return /^\/portal(\/[A-Za-z0-9\-_/]*)?$/.test(n) ? n : '/portal';
}
