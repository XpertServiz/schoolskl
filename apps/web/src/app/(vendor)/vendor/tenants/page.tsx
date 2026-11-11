import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import { createTenantSchema, impersonationRequestSchema } from '@ilmora/validation';
import { requireVendor } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Tenants · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

async function createTenant(form: FormData) {
  'use server';
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') return;
  const input = createTenantSchema.parse({ slug: form.get('slug'), name: form.get('name'), planKey: form.get('plan') || undefined, locale: form.get('locale') || undefined });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('create_tenant', { p_slug: input.slug, p_name: input.name, p_plan_key: input.planKey, p_region: input.region, p_locale: input.locale });
  if (error) throw new Error(error.message);
  revalidatePath('/vendor/tenants');
}

async function startImpersonation(form: FormData) {
  'use server';
  await requireVendor();
  const input = impersonationRequestSchema.parse({ tenantId: form.get('tenantId'), reason: form.get('reason'), ticketRef: form.get('ticket') });
  const sb = await supabaseServer();
  // The DB enforces: reason ≥ 10 chars, ticket present, tenant opted in, ≤ 30 min, audited and visible to the school owner.
  const { error } = await sb.rpc('start_impersonation', { p_tenant: input.tenantId, p_reason: input.reason, p_ticket: input.ticketRef, p_minutes: input.minutes });
  if (error) throw new Error(error.message);
  revalidatePath('/vendor/tenants');
}

export default async function Tenants() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const { role } = await requireVendor();
  const sb = await supabaseServer();
  const { data: tenants } = await sb.from('tenants').select('id, slug, name, status, region, allow_vendor_support').order('created_at', { ascending: false });
  return (
    <div className="wrap">
      <h1>{t(locale, 'vendor.tenants')}</h1>
      {role === 'vendor_super_admin' ? (
        <form action={createTenant} className="card" style={{ display: 'grid', gap: '.75rem', maxWidth: '28rem', marginBottom: '2rem' }}>
          <label>{t(locale, 'vendor.slug')}<input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" dir="ltr" /></label>
          <label>{t(locale, 'vendor.schoolName')}<input name="name" required /></label>
          <button className="btn">{t(locale, 'vendor.create')}</button>
        </form>
      ) : null}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {(tenants ?? []).map((x) => (
          <div key={x.id} className="card">
            <strong>{x.name}</strong> <span className="muted" dir="ltr">{x.slug} · {x.status}</span>
            {x.allow_vendor_support ? (
              <form action={startImpersonation} style={{ display: 'grid', gap: '.5rem', marginTop: '1rem' }}>
                <input type="hidden" name="tenantId" value={x.id} />
                <input name="reason" required minLength={10} placeholder={t(locale, 'vendor.reason')} />
                <input name="ticket" required placeholder={t(locale, 'vendor.ticket')} dir="ltr" />
                <button className="btn">{t(locale, 'vendor.impersonate')}</button>
              </form>
            ) : <p className="muted">{t(locale, 'vendor.supportOff')}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
