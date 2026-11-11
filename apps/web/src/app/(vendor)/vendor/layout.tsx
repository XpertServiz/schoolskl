import Link from 'next/link';
import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  return (
    <>
      <header className="topbar">
        <strong>{t(locale, 'vendor.console')}</strong>
        <nav aria-label="Vendor">
          <Link href="/vendor">{t(locale, 'vx.nav.dashboard')}</Link>
          <Link href="/vendor/tenants">{t(locale, 'vendor.tenants')}</Link>
          <Link href="/vendor/people">{t(locale, 'vendor.people.nav')}</Link>
          <Link href="/vendor/website">{t(locale, 'vx.nav.website')}</Link>
          <Link href="/vendor/visitors">{t(locale, 'vx.nav.visitors')}</Link>
          <Link href="/vendor/billing">Quotes &amp; invoices</Link>
          <Link href="/vendor/reviews">Reviews</Link>
          <Link href="/vendor/leads">{t(locale, 'vendor.leads')}</Link>
          <Link href="/vendor/plans">{t(locale, 'vendor.plans')}</Link>
          <Link href="/vendor/flags">{t(locale, 'vendor.flags')}</Link>
        </nav>
      </header>
      {children}
    </>
  );
}
