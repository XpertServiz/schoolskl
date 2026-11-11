import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { t, type Locale } from '@ilmora/i18n';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Your schools', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

async function choose(form: FormData) {
  'use server';
  const id = String(form.get('tenant') ?? '');
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_active_tenant', { p_tenant: id }); // the DB refuses non-members
  if (error) redirect('/portal/schools');
  await sb.auth.refreshSession(); // re-mint the JWT so the access-token hook stamps the new tenant_id
  redirect('/portal');
}

/** One parent login, several schools — data is never merged; the chosen school becomes the JWT tenant claim. */
export default async function Schools() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  await requireUser();
  const sb = await supabaseServer();
  const { data: schools } = await sb.rpc('my_tenants');
  return (
    <div className="wrap">
      <h1>{t(locale, 'auth.chooseSchool')}</h1>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {(schools ?? []).map((s: { tenant_id: string; name: string }) => (
          <form key={s.tenant_id} action={choose} className="card">
            <input type="hidden" name="tenant" value={s.tenant_id} />
            <button className="btn">{s.name}</button>
          </form>
        ))}
        {schools?.length === 0 ? <p className="muted">{t(locale, 'tenant.notFound')}</p> : null}
      </div>
    </div>
  );
}
