import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { done, fail, getLocale } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Plans · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/plans';

// The modules a plan can include. Keep in step with the app.plan_has_feature() callers in the database.
const FEATURES = ['double_entry_accounting', 'payroll', 'exams_kit', 'admissions_crm', 'custom_domain', 'api', 'sso', 'white_label_apps'] as const;

async function savePlan(form: FormData) {
  'use server';
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') return fail(here, { message: 'permission denied' });
  const plan = z.string().uuid().parse(form.get('plan'));
  const rows = FEATURES.map((f) => ({ plan_id: plan, feature_key: f, enabled: form.get(`f_${f}`) === 'on' }));
  const sb = await supabaseServer();
  // RLS lets only vendor_super_admin write plan_features; a school can never edit its own plan.
  const { error } = await sb.from('plan_features').upsert(rows, { onConflict: 'plan_id,feature_key' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Plans({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  const { role } = await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: plans }, { data: pf }] = await Promise.all([
    sb.from('plans').select('id, key, name, price_minor, currency, limits').order('sort_order'),
    sb.from('plan_features').select('plan_id, feature_key, enabled'),
  ]);
  const on = new Set((pf ?? []).filter((r) => r.enabled).map((r) => `${r.plan_id}:${r.feature_key}`));
  return (
    <div className="wrap">
      <h1>{tr('vendor.plans')}</h1>
      <Flash sp={sp} />
      <div style={{ display: 'grid', gap: '1rem' }}>
        {(plans ?? []).map((p) => (
          <form key={p.id} action={savePlan} className="card">
            <input type="hidden" name="plan" value={p.id} />
            <h2 style={{ marginTop: 0 }}>{p.name} <span className="muted ltr">{p.key}</span></h2>
            {/* DECISION: prices are NULL until the commercial model is decided (open question 3) */}
            <p className="muted">{p.price_minor == null ? tr('vendor.contactUs') : `${p.currency} ${Number(p.price_minor) / 100}`} · <span className="ltr">{JSON.stringify(p.limits)}</span></p>
            <div className="stats">
              {FEATURES.map((f) => (
                <label key={f} className="inline"><input type="checkbox" name={`f_${f}`} defaultChecked={on.has(`${p.id}:${f}`)} disabled={role !== 'vendor_super_admin'} /> <span className="ltr">{f}</span></label>
              ))}
            </div>
            {role === 'vendor_super_admin' ? <p><button className="btn small">{tr('common.save')}</button></p> : null}
          </form>
        ))}
      </div>
    </div>
  );
}
