import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { t, type Locale } from '@ilmora/i18n';
import { AutoSubmit } from '@/components/auto-submit';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Your schools', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

async function choose(form: FormData) {
  'use server';
  const id = String(form.get('tenant') ?? '');
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_active_tenant', { p_tenant: id }); // the DB refuses non-members
  if (error) redirect('/portal/schools?switch=1');
  await sb.auth.refreshSession(); // re-mint the JWT so the access-token hook stamps the new tenant_id
  redirect('/portal');
}

/**
 * After sign-in: platform staff go to the Vendor Console, a person with ONE school goes straight into it, and only someone with several
 * schools sees this picker (data is never merged; the chosen school becomes the active one).
 */
export default async function Schools({ searchParams }: { searchParams: Promise<{ switch?: string }> }) {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const user = await requireUser();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: schools }, { data: vendor }] = await Promise.all([
    sb.rpc('my_tenants'),
    sb.from('vendor_staff').select('role').eq('user_id', user.id).maybeSingle(),
  ]);
  const list = (schools ?? []) as { tenant_id: string; name: string }[];
  if (vendor && list.length === 0) redirect('/vendor');
  const auto = list.length === 1 && !sp.switch;
  return (
    <div className="galaxy">
      <div className="galaxy-stars" aria-hidden="true" />
      <div className="galaxy-in">
        <h1>{auto ? t(locale, 'app.loading') : t(locale, 'auth.chooseSchool')}</h1>
        <div className="planets">
          {list.map((s, i) => (
            <form key={s.tenant_id} action={choose} id={auto ? 'auto' : undefined} className="planet" style={{ ['--i' as string]: i }}>
              <input type="hidden" name="tenant" value={s.tenant_id} />
              <button className="orb" aria-label={s.name}><span className="orb-glow" /><span className="orb-name">{s.name}</span></button>
            </form>
          ))}
        </div>
        {list.length === 0 ? <p className="muted">{t(locale, 'tenant.notFound')}</p> : null}
        {vendor ? <p><a className="btn secondary" href="/vendor">Vendor Console</a></p> : null}
        {auto ? <AutoSubmit formId="auto" /> : null}
      </div>
    </div>
  );
}
