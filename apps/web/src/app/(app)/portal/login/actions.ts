'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

export interface LoginState {
  step: 'email' | 'code';
  email?: string;
  /** a translation KEY; the client form maps it to the user's language */
  error?: string;
}

/**
 * Sign in with a one-time code sent to the person's email (DECISION: email OTP instead of phone OTP until an SMS
 * provider exists). Needs custom SMTP in Supabase (Auth → SMTP) and `{{ .Token }}` in the Magic Link template.
 */
export async function sendCode(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.string().trim().email().safeParse(form.get('email'));
  if (!parsed.success) return { step: 'email', error: 'auth.err.badEmail' };
  const sb = await supabaseServer();
  // shouldCreateUser:false — accounts are invited by the school, never self-registered
  const { error } = await sb.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: false } });
  if (error) return { step: 'email', error: 'auth.err.sendFailed' }; // same message for unknown emails: no account enumeration
  return { step: 'code', email: parsed.data };
}

export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const code = z.string().trim().regex(/^\d{6,8}$/).safeParse(form.get('code'));
  if (!code.success || !prev.email) return { ...prev, step: 'code', error: 'auth.err.badCode' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ email: prev.email, token: code.data, type: 'email' });
  if (error) return { ...prev, step: 'code', error: 'auth.err.wrongCode' };
  redirect('/portal/schools');
}

export async function signInWithPassword(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(Object.fromEntries(form));
  // errors are translation KEYS (the client form shows them in the user's language); one message for every failure: no account enumeration
  if (!parsed.success) return { step: 'email', error: 'auth.err.fields' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { step: 'email', error: 'auth.err.wrong' };
  redirect('/portal/schools');
}
