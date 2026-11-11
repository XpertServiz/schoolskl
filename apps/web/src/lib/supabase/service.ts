import { createClient } from '@supabase/supabase-js';

/**
 * SERVICE-ROLE client: bypasses RLS. Import ONLY from webhook / job route handlers, never from pages, components or server actions
 * that act for a signed-in user (those use ./server.ts and stay under RLS). Every RPC reachable with this key (handle_payment_webhook…)
 * is revoked from the API roles and verifies its own input.
 */
export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
