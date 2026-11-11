import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { t, type Locale } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { findOrCreateLogin } from '@/lib/invite';
import { ROLE_ORDER } from '@/lib/roles';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Add people · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/people';

/**
 * Super admin: add a person (owner, teacher, accountant, driver …) to ANY school. Only vendor_super_admin; the service role is used only to
 * find/create the Auth login by email, then vendor_add_member() (database-checked, audited) adds the membership and role.
 */
async function addPerson(form: FormData) {
  'use server';
  const loc: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const back = (kind: 'ok' | 'err', msg: string): never => redirect(`${here}?${kind}=${encodeURIComponent(msg)}`);
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') return back('err', t(loc, 'vendor.people.onlySuper'));
  const r = z.object({ tenant: z.string().uuid(), email: z.string().email().max(200), name: z.string().min(2).max(120), role: z.string().regex(/^[a-z_]{2,40}$/) })
    .safeParse({ tenant: form.get('tenant'), email: String(form.get('email') ?? '').trim().toLowerCase(), name: String(form.get('name') ?? '').trim(), role: form.get('role') });
  if (!r.success) return back('err', t(loc, 'people.err.fields'));
  let login: { id: string };
  try { login = await findOrCreateLogin(r.data.email, r.data.name); } catch { return back('err', t(loc, 'people.err.login')); }
  const sb = await supabaseServer();
  const { error } = await sb.rpc('vendor_add_member', { p_tenant: r.data.tenant, p_user: login.id, p_full_name: r.data.name, p_role_key: r.data.role });
  if (error) return back('err', error.message);
  revalidatePath(here);
  back('ok', t(loc, 'people.invited', { email: r.data.email }));
}

export default async function VendorPeople({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const { role } = await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: tenants } = await sb.from('tenants').select('id, name, slug, status').neq('status', 'churned').order('name');
  const tr = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  return (
    <div className="wrap">
      <h1>{tr('vendor.people.title')}</h1>
      <Flash sp={sp} />
      <p className="muted">{tr('vendor.people.intro')}</p>
      {role !== 'vendor_super_admin' ? <p role="status" className="notice">{tr('vendor.people.onlySuper')}</p> : (
        <form action={addPerson} className="form card stack">
          <label>{tr('vendor.people.school')}
            <select name="tenant" required defaultValue="">
              <option value="" disabled>—</option>
              {(tenants ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.slug})</option>)}
            </select>
          </label>
          <label>{tr('people.email')} <input name="email" type="email" required maxLength={200} autoComplete="off" className="ltr" /></label>
          <label>{tr('people.name')} <input name="name" required minLength={2} maxLength={120} /></label>
          <label>{tr('people.role')}
            <select name="role" required defaultValue="school_owner">
              {[...ROLE_ORDER].reverse().map((k) => <option key={k} value={k}>{tr(`people.roles.${k}`)}</option>)}
            </select>
          </label>
          <p className="muted">{tr('vendor.people.note')}</p>
          <button className="btn">{tr('people.inviteBtn')}</button>
        </form>
      )}
    </div>
  );
}
