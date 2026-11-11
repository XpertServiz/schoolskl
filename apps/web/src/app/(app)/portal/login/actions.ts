'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { pkMobileSchema } from '@ilmora/validation';
import { supabaseServer } from '@/lib/supabase/server';

export interface LoginState {
  step: 'phone' | 'code';
  phone?: string;
  error?: string;
}

/** Parents (and staff who prefer it) sign in with a phone OTP. Numbers are normalised to E.164 first. */
export async function sendCode(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = pkMobileSchema.safeParse(form.get('phone'));
  if (!parsed.success) return { step: 'phone', error: parsed.error.issues[0]?.message };
  const sb = await supabaseServer();
  // shouldCreateUser:false — accounts are invited by the school, never self-registered
  const { error } = await sb.auth.signInWithOtp({ phone: parsed.data, options: { shouldCreateUser: false } });
  if (error) return { step: 'phone', error: 'We could not send a code to that number.' }; // no account enumeration
  return { step: 'code', phone: parsed.data };
}

export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const code = z.string().regex(/^\d{6}$/).safeParse(form.get('code'));
  if (!code.success || !prev.phone) return { ...prev, step: 'code', error: 'Enter the 6-digit code.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ phone: prev.phone, token: code.data, type: 'sms' });
  if (error) return { ...prev, step: 'code', error: 'That code is wrong or has expired.' };
  redirect('/portal/schools');
}

export async function signInWithPassword(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(Object.fromEntries(form));
  // errors are translation KEYS (the client form shows them in the user's language); one message for every failure: no account enumeration
  if (!parsed.success) return { step: 'phone', error: 'auth.err.fields' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { step: 'phone', error: 'auth.err.wrong' };
  redirect('/portal/schools');
}
