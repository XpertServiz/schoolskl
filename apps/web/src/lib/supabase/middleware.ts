import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Keeps the Supabase session alive. Server Components cannot write cookies, so an expired access token would otherwise log people out
 * mid-session. The middleware asks Auth for the user (which refreshes the token when needed) and copies any new cookies onto the response
 * that is actually sent — including the rewrite the host router produces. Without Supabase configured this is a no-op.
 * Only the app/vendor surfaces call it; public marketing and tenant sites never touch auth.
 */
export async function refreshSession(req: NextRequest, res: NextResponse): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  // only bother when the browser actually holds a session cookie
  if (!req.cookies.getAll().some((c) => c.name.startsWith('sb-'))) return res;

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) => {
        all.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  try {
    await sb.auth.getUser();
  } catch {
    /* auth outage: serve the page; the page's own requireUser() will decide what to do */
  }
  return res;
}
