import { notFound } from 'next/navigation';
import { t } from '@ilmora/i18n';
import { LocaleRoot } from '@/components/locale-root';
import { resolveTenant } from '@/lib/tenant';
import { portalLoginUrl } from '@/lib/urls';

// DECISION (CPU): a school's public page is built on its first visit and served from cache for an hour (ISR), per host — it holds only
// the public branding that resolve_tenant returns, never a record. An unknown host is cached as a 404 for the same hour.
export const revalidate = 3600;
export function generateStaticParams() { return []; }

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const tenant = await resolveTenant(decodeURIComponent((await params).host)); // same cached lookup as the page
  if (!tenant) return { robots: { index: false, follow: false } };
  const b = tenant.branding ?? {};
  const description = text(b.tagline, 160) ?? text(b.about, 160) ?? undefined;
  return { title: tenant.name, description, openGraph: { title: tenant.name, description, type: 'website' as const }, robots: { index: true, follow: true } };
}

/**
 * A school's public front door. It shows only what resolve_tenant returns (public branding) — never any record. Branding fields are plain
 * text rendered as text (no HTML), and sign-in leads to the app host where the real session and RLS take over.
 * The block-based site builder is not built yet; until then a school's page is its name + the optional branding.tagline / about / phone.
 */
export default async function TenantHome({ params }: { params: Promise<{ host: string }> }) {
  const host = decodeURIComponent((await params).host);
  const tenant = await resolveTenant(host);
  if (!tenant) notFound(); // unknown / unverified host → 404, never another school's page
  const b = tenant.branding ?? {};
  const tagline = text(b.tagline, 160), about = text(b.about, 1500), phone = text(b.phone, 30), address = text(b.address, 200);
  return (
    <LocaleRoot locale={tenant.locale}>
    <div className="wrap" lang={tenant.locale} dir={tenant.locale === 'ur' ? 'rtl' : 'ltr'}>
      <h1>{tenant.name}</h1>
      {tagline ? <p className="muted" style={{ fontSize: '1.15rem' }}>{tagline}</p> : null}
      <p><a className="btn" href={portalLoginUrl()}>{t(tenant.locale, 'auth.signIn')}</a></p>
      {about ? <section className="card"><p style={{ whiteSpace: 'pre-line', margin: 0 }}>{about}</p></section> : null}
      {phone || address ? (
        <p className="muted">{address}{address && phone ? ' · ' : ''}{phone ? <span className="ltr">{phone}</span> : null}</p>
      ) : null}
    </div>
    </LocaleRoot>
  );
}
