import Link from 'next/link';
import { t } from '@ilmora/i18n';
import { LocaleRoot } from '@/components/locale-root';
import { Icons } from '@/components/landing/icons';
import { Splash } from '@/components/landing/Splash';
import { asLocale } from '@/lib/locale';
import { setLocale } from '@/lib/locale-action';
import { portalLoginUrl } from '@/lib/urls';
import '../../../landing.css';

// DECISION: the brand is never hard-coded; it comes from the same env var as the root layout until the Vendor Console has Brand settings.
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmora';

// DECISION (CPU): marketing pages are built once per language and served from cache. The visitor's `locale` cookie still decides the
// language — middleware rewrites "/pricing" to "/m/<lang>/pricing" — so nothing changes for people, only no render per visit.
export const dynamicParams = false;
export function generateStaticParams() { return [{ lang: 'en' }, { lang: 'ur' }]; }

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const locale = asLocale((await params).lang);
  const tr = (k: string) => t(locale, k);
  return (
    <LocaleRoot locale={locale}>
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
    </LocaleRoot>
  );
}
