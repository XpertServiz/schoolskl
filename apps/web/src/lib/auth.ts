import { redirect } from 'next/navigation';
import { cache } from 'react';
import { supabaseServer } from './supabase/server';

/** The verified user (getUser() round-trips to Auth — never trust getSession() cookies on the server). */
// memoised for the current request only (see lib/portal.ts): one Auth round-trip per page view, never shared across requests
export const currentUser = cache(async () => {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/portal/login');
  return user;
}

/** Vendor staff only. The check is a normal RLS-protected read: vendor_staff shows a row only to its owner / the super admin. */
export async function requireVendor() {
  const user = await requireUser();
  const sb = await supabaseServer();
  const { data } = await sb.from('vendor_staff').select('role').eq('user_id', user.id).maybeSingle();
  if (!data) redirect('/not-found');
  return { user, role: data.role as 'vendor_super_admin' | 'vendor_support' | 'vendor_finance' };
}
