import Link from 'next/link';
import { t } from '@ilmora/i18n';
import { LocaleRoot } from '@/components/locale-root';
import { Icons } from '@/components/landing/icons';
import { Splash } from '@/components/landing/Splash';
import { ChatWidget } from '@/components/landing/ChatWidget';
import { VisitBeacon } from '@/components/landing/VisitBeacon';
import { asLocale } from '@/lib/locale';
import { setLocale } from '@/lib/locale-action';
import { getSiteContent, whatsappLink } from '@/lib/site-content';
import { portalLoginUrl } from '@/lib/urls';
import '../../../landing.css';

// DECISION: the brand is never hard-coded; it comes from the same env var as the root layout until the Vendor Console has Brand settings.
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';

// DECISION (CPU): marketing pages are built once per language and served from cache (refreshed every 10 minutes, and at once when the
// super admin saves the Website page). The visitor's `locale` cookie still decides the language — middleware rewrites "/pricing" to
// "/m/<lang>/pricing" — so nothing changes for people, only no render per visit.
export const dynamicParams = false;
export const revalidate = 600;
export function generateStaticParams() { return [{ lang: 'en' }, { lang: 'ur' }]; }

const SOCIAL: [string, string][] = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']];
const safeUrl = (v?: string) => (v && /^https:\/\/[^\s<>"]+$/.test(v) ? v : null);

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const locale = asLocale((await params).lang);
  const tr = (k: string) => t(locale, k);
  const { settings } = await getSiteContent();
  const notice = (locale === 'ur' ? settings.announcement_ur || settings.announcement_en : settings.announcement_en) ?? '';
  const wa = whatsappLink(settings.whatsapp);
  const social = SOCIAL.map(([k, label]) => [label, safeUrl(settings[k])] as const).filter(([, u]) => u);
  return (
    <LocaleRoot locale={locale} theme={['teal', 'violet', 'rose'].includes(settings.theme ?? '') ? settings.theme : undefined}>
      <Splash name={product} />
      <VisitBeacon lang={locale} />
      {notice ? <div className="l-notice" role="status">{notice}</div> : null}
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
          <span><Link href="/privacy">{tr('marketing.nav.privacy')}</Link> · <Link href="/apps">{tr('marketing.nav.apps')}</Link> · <Link href="/demo">{tr('marketing.nav.demo')}</Link>
            {social.map(([label, u]) => <span key={label}> · <a href={u!} target="_blank" rel="noopener noreferrer me">{label}</a></span>)}
            {settings.email ? <span> · <a href={`mailto:${settings.email}`} className="ltr">{settings.email}</a></span> : null}
            {settings.phone ? <span> · <a href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`} className="ltr">{settings.phone}</a></span> : null}
          </span>
        </div>
      </footer>
      <ChatWidget lang={locale} whatsapp={wa} name={product} />
      {wa ? <a className="wa-float" href={wa} target="_blank" rel="noopener noreferrer" aria-label={tr('site.whatsapp')}>💬 <span>{tr('site.whatsapp')}</span></a> : null}
    </LocaleRoot>
  );
}
