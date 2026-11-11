import Link from 'next/link';
import { t, type Locale } from '@ilmora/i18n';
import { asLocale } from '@/lib/locale';
import { seo } from '@/lib/seo';
import { Icons } from '@/components/landing/icons';
import { PhoneMock } from '@/components/landing/PhoneMock';
import { portalLoginUrl } from '@/lib/urls';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const l = asLocale((await params).lang);
  return seo(l, '/apps', t(l, 'marketing.nav.apps'));
}

/**
 * Where the apps are. Honest status: the web app is usable (and installable) today; the store apps are built and tested but not yet published —
 * no fake download buttons. The web app lives on app.<root domain>.
 */
export default async function Apps({ params }: { params: Promise<{ lang: string }> }) {
  const locale: Locale = asLocale((await params).lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const webApp = portalLoginUrl();
  return (
    <div className="l-wrap l-section">
      <h1 style={{ fontSize: 'clamp(2rem,5vw,3.2rem)' }}>{tr('marketing.appsPage.title')}</h1>
      <p className="l-sub">{tr('marketing.appsPage.sub')}</p>

      <div className="apps-grid" style={{ marginBottom: '3rem' }}>
        <div className="phones" aria-label={tr('marketing.mock.caption')}>
          <PhoneMock kind="parent" tr={tr} />
          <PhoneMock kind="teacher" tr={tr} />
        </div>
        <ul className="app-list">
          <li><span className="ic">{Icons.office}</span><div>
            <h3>{tr('marketing.apps.office')} <span className="status live">{tr('marketing.appsPage.available')}</span></h3>
            <p>{tr('marketing.landing.apps.officeBody')}</p>
            <p style={{ marginTop: '.7rem' }}><a className="b b-primary" href={webApp}>{tr('marketing.appsPage.openWeb')}</a></p>
          </div></li>
          <li><span className="ic">{Icons.users}</span><div>
            <h3>{tr('marketing.apps.parent')} <span className="status soon">{tr('marketing.appsPage.testing')}</span></h3>
            <p>{tr('marketing.landing.apps.parentBody')}</p>
          </div></li>
          <li><span className="ic">{Icons.attendance}</span><div>
            <h3>{tr('marketing.apps.teacher')} <span className="status soon">{tr('marketing.appsPage.testing')}</span></h3>
            <p>{tr('marketing.landing.apps.teacherBody')}</p>
          </div></li>
        </ul>
      </div>

      <h2>{tr('marketing.appsPage.installTitle')}</h2>
      <p className="l-sub">{tr('marketing.appsPage.installSub')}</p>
      <div className="install">
        <div className="feat"><h3>Android · Chrome</h3><ol>{(['a1', 'a2', 'a3'] as const).map((s) => <li key={s}>{tr(`marketing.appsPage.android.${s}`)}</li>)}</ol></div>
        <div className="feat"><h3>iPhone · Safari</h3><ol>{(['i1', 'i2', 'i3'] as const).map((s) => <li key={s}>{tr(`marketing.appsPage.ios.${s}`)}</li>)}</ol></div>
        <div className="feat"><h3>{tr('marketing.appsPage.computer')}</h3><ol>{(['c1', 'c2'] as const).map((s) => <li key={s}>{tr(`marketing.appsPage.pc.${s}`)}</li>)}</ol></div>
      </div>

      <section className="cta-band" style={{ marginTop: '3rem' }}>
        <h2>{tr('marketing.appsPage.storeTitle')}</h2>
        <p>{tr('marketing.appsPage.storeBody')}</p>
        <Link className="b b-primary" href="/demo">{tr('marketing.hero.cta')}</Link>
      </section>
    </div>
  );
}
