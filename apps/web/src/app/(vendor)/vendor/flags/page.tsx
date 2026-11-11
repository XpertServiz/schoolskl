import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { done, fail, getLocale } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Flags · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/flags';

async function setFlag(form: FormData) {
  'use server';
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') return fail(here, { message: 'permission denied' });
  const r = z.object({ tenant: z.string().uuid(), flag: z.string().min(1).max(64), on: z.enum(['1', '0']) }).safeParse({ tenant: form.get('tenant'), flag: form.get('flag'), on: form.get('on') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  // For flags that track or profile children the DATABASE refuses "on" unless a written legal opinion is recorded — the message is shown as-is.
  const { error } = await sb.from('tenant_flags').upsert({ tenant_id: r.data.tenant, flag_key: r.data.flag, enabled: r.data.on === '1' }, { onConflict: 'tenant_id,flag_key' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function recordOpinion(form: FormData) {
  'use server';
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') return fail(here, { message: 'permission denied' });
  const r = z.object({ flag: z.string().min(1).max(64), ref: z.string().trim().max(300) }).safeParse({ flag: form.get('flag'), ref: form.get('ref') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.from('feature_flags').update({ legal_ref: r.data.ref || null }).eq('key', r.data.flag).eq('requires_legal_ref', true);
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Flags({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  const { role } = await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: flags }, { data: tenants }, { data: tf }] = await Promise.all([
    sb.from('feature_flags').select('key, description, default_enabled, requires_legal_ref, legal_ref').order('key'),
    sb.from('tenants').select('id, name, slug').order('name'),
    sb.from('tenant_flags').select('tenant_id, flag_key, enabled'),
  ]);
  const state = new Map((tf ?? []).map((r) => [`${r.tenant_id}:${r.flag_key}`, r.enabled as boolean]));
  const admin = role === 'vendor_super_admin';
  return (
    <div className="wrap">
      <h1>{tr('vendor.flags')}</h1>
      <Flash sp={sp} />
      {(flags ?? []).map((f) => {
        const blocked = f.requires_legal_ref && !(f.legal_ref ?? '').trim();
        return (
          <section key={f.key} className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0 }}><span className="ltr">{f.key}</span></h2>
            <p className="muted">{f.description}</p>
            {f.requires_legal_ref ? (
              <form action={recordOpinion} className="inline">
                <input type="hidden" name="flag" value={f.key} />
                <label className="inline">{tr('vendor.legalRef')}<input name="ref" defaultValue={f.legal_ref ?? ''} disabled={!admin} size={40} /></label>
                {admin ? <button className="btn secondary small">{tr('common.save')}</button> : null}
                {blocked ? <span role="note" className="pill">{tr('vendor.legalMissing')}</span> : null}
              </form>
            ) : null}
            <div className="table-scroll"><table className="grid">
              <tbody>
                {(tenants ?? []).map((tn) => {
                  const enabled = state.get(`${tn.id}:${f.key}`) ?? f.default_enabled;
                  return (
                    <tr key={tn.id}>
                      <td>{tn.name} <span className="muted ltr">{tn.slug}</span></td>
                      <td><span className="pill">{enabled ? tr('vendor.on') : tr('vendor.off')}</span></td>
                      <td>
                        {admin ? (
                          <form action={setFlag}>
                            <input type="hidden" name="tenant" value={tn.id} /><input type="hidden" name="flag" value={f.key} /><input type="hidden" name="on" value={enabled ? '0' : '1'} />
                            <button className="btn secondary small" disabled={blocked && !enabled}>{enabled ? tr('vendor.turnOff') : tr('vendor.turnOn')}</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        );
      })}
    </div>
  );
}
