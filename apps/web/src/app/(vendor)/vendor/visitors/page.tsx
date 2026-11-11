import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import { requireVendor } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Visitors · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Row = { day: string; path: string; lang: string; visits: number; views: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Website visitors from the privacy-friendly counter: daily totals per page and language, nothing personal. */
export default async function Visitors() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  await requireVendor();
  const sb = await supabaseServer();
  const today = iso(new Date());
  const from = iso(new Date(Date.now() - 29 * 864e5)), from7 = iso(new Date(Date.now() - 6 * 864e5));
  const { data } = await sb.from('site_visits').select('day, path, lang, visits, views').gte('day', from).order('day', { ascending: false });
  const rows = (data ?? []) as Row[];
  const tot = (f: (r: Row) => boolean) => rows.filter(f).reduce((a, r) => ({ visits: a.visits + r.visits, views: a.views + r.views }), { visits: 0, views: 0 });
  const periods: [string, { visits: number; views: number }][] = [[tr('vx.visitors.today'), tot((r) => r.day === today)], [tr('vx.visitors.week'), tot((r) => r.day >= from7)], [tr('vx.visitors.month'), tot(() => true)]];
  const byDay = new Map<string, { visits: number; views: number }>();
  const byPage = new Map<string, number>(); const byLang = new Map<string, number>();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { visits: 0, views: 0 }; d.visits += r.visits; d.views += r.views; byDay.set(r.day, d);
    byPage.set(r.path, (byPage.get(r.path) ?? 0) + r.views); byLang.set(r.lang, (byLang.get(r.lang) ?? 0) + r.views);
  }
  const days = [...Array(14)].map((_, i) => iso(new Date(Date.now() - i * 864e5)));
  const peak = Math.max(1, ...days.map((d) => byDay.get(d)?.views ?? 0));
  const top = [...byPage.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="wrap">
      <h1>{tr('vx.visitors.title')}</h1>
      <p className="muted">{tr('vx.visitors.intro')}</p>
      <div className="kpis">
        {periods.map(([label, v]) => <div key={label} className="card"><span className="muted">{label}</span><b className="kpi">{v.visits}</b><span className="muted">{tr('vx.visitors.visits')} · {v.views} {tr('vx.visitors.views')}</span></div>)}
      </div>
      {rows.length === 0 ? <p className="muted">{tr('vx.visitors.empty')}</p> : (
        <>
          <h2>{tr('vx.visitors.byDay')}</h2>
          <div className="table-scroll"><table className="grid">
            <thead><tr><th>{tr('vx.visitors.day')}</th><th className="num">{tr('vx.visitors.visits')}</th><th className="num">{tr('vx.visitors.views')}</th><th style={{ width: '40%' }} /></tr></thead>
            <tbody>{days.map((d) => { const v = byDay.get(d) ?? { visits: 0, views: 0 }; return (
              <tr key={d}><td className="ltr">{d}</td><td className="num">{v.visits}</td><td className="num">{v.views}</td><td><div className="hbar"><span style={{ width: `${(v.views / peak) * 100}%` }} /></div></td></tr>
            ); })}</tbody>
          </table></div>
          <h2>{tr('vx.visitors.topPages')}</h2>
          <table className="grid"><thead><tr><th>{tr('vx.visitors.page')}</th><th className="num">{tr('vx.visitors.views')}</th></tr></thead>
            <tbody>{top.map(([p, n]) => <tr key={p}><td className="ltr">{p}</td><td className="num">{n}</td></tr>)}</tbody></table>
          <h2>{tr('vx.visitors.langs')}</h2>
          <p>{[...byLang.entries()].map(([l, n]) => `${l === 'ur' ? 'اردو' : 'English'}: ${n}`).join('  ·  ')}</p>
        </>
      )}
      <p className="muted">{tr('vx.visitors.note')}</p>
    </div>
  );
}
