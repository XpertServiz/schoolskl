'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** Language switch for every surface. `back` must be a same-site path; anything else falls back to the home page. */
export async function setLocale(form: FormData) {
  (await cookies()).set('locale', form.get('to') === 'ur' ? 'ur' : 'en', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const back = String(form.get('back') ?? '/');
  redirect(/^\/[A-Za-z0-9\-_/]*$/.test(back) ? back : '/');
}
