import { NextResponse } from 'next/server';
import { allow, clientIp } from '@/lib/rate-limit';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lets the phone app open the full web portal inside the app already signed in: the app POSTs the person's OWN session tokens, we verify
 * them with Supabase Auth (setSession rejects anything that is not a valid session), set the usual cookies and redirect into the portal.
 * Tokens travel in a POST body, never in the address. Only /portal and /vendor are valid destinations.
 */
export async function POST(req: Request) {
  if (!allow('mobile-session', await clientIp(), 30, 60)) return new NextResponse('Too many attempts', { status: 429 });
  const form = await req.formData().catch(() => null);
  const access = String(form?.get('access_token') ?? ''), refresh = String(form?.get('refresh_token') ?? '');
  const next = String(form?.get('next') ?? '/portal');
  const dest = /^\/(portal|vendor)(\/[A-Za-z0-9/_-]*)?$/.test(next) ? next : '/portal';
  if (access.length < 20 || refresh.length < 5) return new NextResponse('Bad request', { status: 400 });
  const sb = await supabaseServer();
  const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
  if (error) return new NextResponse('Session not accepted — please sign in again', { status: 401 });
  const url = new URL(dest, req.url);
  return NextResponse.redirect(url, 303);
}
