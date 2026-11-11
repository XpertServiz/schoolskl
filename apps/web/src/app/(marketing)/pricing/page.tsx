import Link from 'next/link';
import { cookies } from 'next/headers';
import { formatMoney, money } from '@ilmora/core';
import { t, type Locale } from '@ilmora/i18n';

export const metadata = { title: 'Pricing' };
export const revalidate = 300;

interface Plan { key: string; name: string; price_minor: number | null; currency: string; limits: Record<string, number | null>; sort_order: number }

/** The public catalogue is the one thing `anon` may read (plans + plan_features), straight from the database. */
async function catalogue(): Promise<{ plans: Plan[]; features: Record<string, Set<string>> } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    const [p, f] = await Promise.all([
      fetch(`${url}/rest/v1/plans?select=id,key,name,price_minor,currency,limits,sort_order&order=sort_order`, { headers: h, next: { revalidate: 300 } }),
      fetch(`${url}/rest/v1/plan_features?select=plan_id,feature_key,enabled&enabled=eq.true`, { headers: h, next: { revalidate: 300 } }),
    ]);
    if (!p.ok || !f.ok) return null;
    const plans = (await p.json()) as (Plan & { id: string })[];
    const feats = (await f.json()) as { plan_id: string; feature_key: string }[];
    const byKey: Record<string, Set<string>> = {};
    for (const pl of plans) byKey[pl.key] = new Set(feats.filter((x) => x.plan_id === pl.id).map((x) => x.feature_key));
    return { plans, features: byKey };
  } catch { return null; }
}

const ALL = ['double_entry_accounting', 'payroll', 'exams_kit', 'admissions_crm', 'custom_domain', 'api'] as const;

export default async function Pricing() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const data = await catalogue();
  return (
    <div className="wrap">
      <h1>{tr('marketing.pricing.title')}</h1>
      <p className="muted">{tr('marketing.pricing.subtitle')}</p>
      {!data ? <p className="card">{tr('marketing.pricing.unavailable')}</p> : (
        <div className="stats">
          {data.plans.map((p) => (
            <section key={p.key} className="card">
              <h2 style={{ marginTop: 0 }}>{p.name}</h2>
              {/* DECISION: prices are NULL until the commercial model is decided (open question 3) → "Contact us", never an invented number */}
              <p className="stat"><span className="num">{p.price_minor == null ? tr('vendor.contactUs') : formatMoney(money(BigInt(p.price_minor), p.currency), locale === 'ur' ? 'ur-PK' : 'en-PK')}</span></p>
              <ul>
                {p.limits.max_students ? <li>{tr('marketing.pricing.students', { n: p.limits.max_students })}</li> : null}
                {p.limits.max_campuses ? <li>{tr('marketing.pricing.campuses', { n: p.limits.max_campuses })}</li> : p.key === 'chain' ? <li>{tr('marketing.pricing.manyCampuses')}</li> : null}
                {ALL.filter((f) => data.features[p.key]?.has(f)).map((f) => <li key={f}>{tr(`marketing.pricing.feature.${f}`)}</li>)}
              </ul>
              <Link className="btn" href="/demo">{tr('marketing.hero.cta')}</Link>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
