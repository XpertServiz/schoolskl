import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { findOrCreateLogin } from '@/lib/invite';
import { allow, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The phone app calls this with the signed-in person's own access token (a Bearer token, never a cookie), so any origin may call it:
// without a valid token it does nothing. CORS also lets the web build of the app be tested in a browser.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...CORS } });
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

const body = z.object({
  email: z.string().email().max(200), name: z.string().min(2).max(120), role: z.string().regex(/^[a-z_]{2,40}$/),
  tenant: z.string().uuid().optional(), // present only for the super admin adding someone to a chosen school
});

/**
 * Add a person (teacher, driver, accountant … or, for the super admin, anyone to any school) from the phone app.
 * Order matters: 1) verify the caller's token, 2) ask the DATABASE whether this caller may add people (school owner / users.manage with 2FA,
 * or super admin) — and only then 3) use the service role to find-or-create the Auth login, 4) run invite_member / vendor_add_member AS
 * THE CALLER so the database applies its own rules (no escalation, owner-only roles, audit). The service role never decides who may do what.
 */
export async function POST(req: Request) {
  const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return json({ ok: false, code: 'unauthorised' }, 401);
  if (!allow('people-api', await clientIp(), 30, 60)) return json({ ok: false, code: 'too_many' }, 429);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, code: 'fields' }, 400);
  const b = parsed.data;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return json({ ok: false, code: 'not_configured' }, 500);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return json({ ok: false, code: 'unauthorised' }, 401);

  if (b.tenant) {
    const { data } = await sb.from('vendor_staff').select('role').eq('user_id', u.user.id).maybeSingle();
    if (data?.role !== 'vendor_super_admin') return json({ ok: false, code: 'forbidden' }, 403);
  } else {
    const { data: pa } = await sb.rpc('people_access');
    if (!(pa as { can?: boolean } | null)?.can) return json({ ok: false, code: 'forbidden' }, 403);
  }

  let login: { id: string };
  try { login = await findOrCreateLogin(b.email.toLowerCase(), b.name); } catch { return json({ ok: false, code: 'login_failed' }, 500); }
  const { data, error } = b.tenant
    ? await sb.rpc('vendor_add_member', { p_tenant: b.tenant, p_user: login.id, p_full_name: b.name, p_role_key: b.role })
    : await sb.rpc('invite_member', { p_user: login.id, p_full_name: b.name, p_role_key: b.role });
  if (error) return json({ ok: false, code: error.hint ?? 'failed', message: error.message }, 400);
  return json({ ok: true, role: (data as { role?: string } | null)?.role ?? b.role });
}
