import Link from 'next/link';
import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import { Icons } from '@/components/landing/icons';
import { Splash } from '@/components/landing/Splash';
import { setLocale } from '@/lib/locale-action';
import { portalLoginUrl } from '@/lib/urls';
import '../landing.css';

// DECISION: the brand is never hard-coded; it comes from the same env var as the root layout until the Vendor Console has Brand settings.
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmora';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  return (
    <>
      <Splash name={product} />
      <header className="l-header">
        <div className="l-wrap">
          <Link href="/" className="l-brand">{Icons.logo}{product}</Link>
          <nav aria-label="Main" className="l-nav">
            <Link href="/#features">{tr('marketing.nav.features')}</Link>
            <Link href="/apps">{tr('marketing.nav.apps')}</Link>
            <Link href="/pricing">{tr('marketing.nav.pricing')}</Link>
            <Link href="/privacy">{tr('marketing.nav.privacy')}</Link>
          </nav>
          <form action={setLocale}>
            <input type="hidden" name="to" value={locale === 'ur' ? 'en' : 'ur'} />
            <input type="hidden" name="back" value="/" />
            <button className="l-lang" lang={locale === 'ur' ? 'en' : 'ur'}>{tr('nav.language')}</button>
          </form>
          <a href={portalLoginUrl()} className="l-signin">{tr('auth.signIn')}</a>
          <Link href="/demo" className="b b-primary">{tr('marketing.nav.demo')}</Link>
        </div>
      </header>
      {children}
      <footer className="l-footer">
        <div className="l-wrap">
          <span>© {new Date().getFullYear()} {product} · {tr('marketing.footer')}</span>
          <span><Link href="/privacy">{tr('marketing.nav.privacy')}</Link> · <Link href="/apps">{tr('marketing.nav.apps')}</Link> · <Link href="/demo">{tr('marketing.nav.demo')}</Link></span>
        </div>
      </footer>
    </>
  );
}
