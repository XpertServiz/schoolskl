import Link from 'next/link';
import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import { requireVendor } from '@/lib/auth';
import { siteUrl } from '@/lib/seo';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type School = { tenant_id: string; slug: string; name: string; status: string; plan_key: string | null; created_at: string; students: number; staff: number; members: number };

/** Super-admin home: platform numbers at a glance (counts only — no school records) and quick links to the tools you use. */
export default async function Dashboard() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  await requireVendor(); // non-vendor users never learn this console exists (404)
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const [{ data }, { data: vis }, { count: leads }] = await Promise.all([
    sb.rpc('vendor_overview'),
    sb.from('site_visits').select('visits, views').gte('day', since),
    sb.from('demo_requests').select('id', { count: 'exact', head: true }).is('handled_at', null),
  ]);
  const schools = (data ?? []) as School[];
  const sum = (k: 'students' | 'staff') => schools.reduce((a, s) => a + s[k], 0);
  const visits7 = (vis ?? []).reduce((a, r) => a + Number(r.visits), 0);
  const supa = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const tools: [string, string][] = [
    [tr('vx.dash.viewSite'), siteUrl()],
    [tr('vx.dash.apk'), 'https://github.com/XpertServiz/schoolskl/releases/download/apk-latest/school-android.apk'],
    [tr('vx.dash.searchConsole'), 'https://search.google.com/search-console'],
    [tr('vx.dash.db'), `https://supabase.com/dashboard/project/${supa}`],
    [tr('vx.dash.hosting'), 'https://vercel.com/khanather/schoolskl'],
    [tr('vx.dash.code'), 'https://github.com/XpertServiz/schoolskl'],
    [tr('vx.dash.mail'), 'https://resend.com/emails'],
  ];
  return (
    <div className="wrap">
      <h1>{tr('vx.dash.title')}</h1>
      <p className="muted">{tr('vx.dash.intro')}</p>
      <div className="kpis">
        <div className="card"><span className="muted">{tr('vx.dash.schools')}</span><b className="kpi">{schools.length}</b><span className="muted">{schools.filter((s) => s.status === 'live').length} {tr('vx.dash.live')} · {schools.filter((s) => s.status === 'trial' || s.status === 'onboarding').length} {tr('vx.dash.trial')}</span></div>
        <div className="card"><span className="muted">{tr('vx.dash.students')}</span><b className="kpi">{sum('students')}</b></div>
        <div className="card"><span className="muted">{tr('vx.dash.staff')}</span><b className="kpi">{sum('staff')}</b></div>
        <Link href="/vendor/visitors" className="card"><span className="muted">{tr('vx.dash.visits7')}</span><b className="kpi">{visits7}</b></Link>
        <Link href="/vendor/leads" className="card"><span className="muted">{tr('vx.dash.leads')}</span><b className="kpi">{leads ?? 0}</b></Link>
      </div>

      <h2>{tr('vx.dash.perSchool')}</h2>
      {schools.length === 0 ? <p className="muted">{tr('vx.dash.none')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{tr('vx.dash.schools')}</th><th>{tr('ui.status')}</th><th>{tr('vx.dash.plan')}</th><th className="num">{tr('vx.dash.students')}</th><th className="num">{tr('vx.dash.staff')}</th><th className="num">{tr('vx.dash.people')}</th><th>{tr('vx.dash.created')}</th></tr></thead>
          <tbody>{schools.map((s) => (
            <tr key={s.tenant_id}><td><Link href="/vendor/tenants">{s.name}</Link> <span className="muted ltr">{s.slug}</span></td><td><span className="pill">{s.status}</span></td><td>{s.plan_key ?? '—'}</td>
              <td className="num">{s.students}</td><td className="num">{s.staff}</td><td className="num">{s.members}</td><td className="ltr">{s.created_at.slice(0, 10)}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      <h2>{tr('vx.dash.tools')}</h2>
      <div className="quick">{tools.map(([label, href]) => <a key={href} className="btn secondary" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a>)}</div>
    </div>
  );
}
