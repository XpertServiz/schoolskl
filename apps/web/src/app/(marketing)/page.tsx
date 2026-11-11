import Link from 'next/link';
import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';
import Campus3DLazy from '@/components/landing/Campus3DLazy';
import { Icons } from '@/components/landing/icons';
import { PhoneMock } from '@/components/landing/PhoneMock';

export const metadata = { description: 'School management for Pakistan — fees, results, attendance and parent messages, in English and Urdu, with apps for parents and teachers.' };

const READY = [['fees', Icons.fees], ['ledger', Icons.ledger], ['results', Icons.results], ['attendance', Icons.attendance], ['urdu', Icons.language]] as const;
const NEXT = [['saferoute', Icons.bus], ['compass', Icons.compass]] as const;
const TRUST = [['noAds', Icons.eyeOff], ['consent', Icons.hand], ['isolation', Icons.lock], ['noLabels', Icons.shield]] as const;

export default async function Home() {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  return (
    <div>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <div className="l-wrap hero-grid">
          <div>
            <span className="eyebrow">{tr('marketing.landing.eyebrow')}</span>
            <h1>{tr('marketing.hero.title')}</h1>
            <p className="lead">{tr('marketing.hero.subtitle')}</p>
            <div className="hero-cta">
              <Link className="b b-primary" href="/demo">{tr('marketing.hero.cta')}</Link>
              <Link className="b b-ghost" href="/apps">{tr('marketing.landing.ctaApps')}</Link>
            </div>
            <p className="hero-note">{tr('marketing.landing.heroNote')}</p>
          </div>
          <div className="campus-card">
            <Campus3DLazy label={tr('marketing.landing.campusLabel')} />
            <p className="campus-hint">{tr('marketing.landing.dragHint')}</p>
          </div>
        </div>
      </section>

      <div className="l-wrap">
        <div className="strip">
          <div>{Icons.language}{tr('marketing.landing.strip.urdu')}</div>
          <div>{Icons.offline}{tr('marketing.landing.strip.offline')}</div>
          <div>{Icons.ledger}{tr('marketing.landing.strip.balanced')}</div>
          <div>{Icons.eyeOff}{tr('marketing.landing.strip.private')}</div>
        </div>
      </div>

      {/* ------------------------------------------------------------ features */}
      <section id="features" className="l-section l-wrap">
        <h2>{tr('marketing.ready.title')}</h2>
        <p className="l-sub">{tr('marketing.landing.featuresSub')}</p>
        <div className="feat-grid">
          {READY.map(([k, icon]) => (
            <article key={k} className="feat">
              <div className="ic">{icon}</div>
              <h3>{tr(`marketing.ready.${k}.title`)}</h3>
              <p>{tr(`marketing.ready.${k}.body`)}</p>
            </article>
          ))}
          <article className="feat">
            <div className="ic">{Icons.offline}</div>
            <h3>{tr('marketing.landing.offlineTitle')}</h3>
            <p>{tr('marketing.landing.offlineBody')}</p>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="l-section l-wrap">
        <h2>{tr('marketing.landing.how.title')}</h2>
        <div className="steps">
          {(['s1', 's2', 's3'] as const).map((s) => (
            <div key={s} className="step"><h3>{tr(`marketing.landing.how.${s}.t`)}</h3><p>{tr(`marketing.landing.how.${s}.b`)}</p></div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ apps */}
      <section className="l-section apps-band">
        <div className="l-wrap apps-grid">
          <div>
            <h2 className="l-head">{tr('marketing.landing.apps.title')}</h2>
            <p className="l-sub" style={{ marginBottom: 0 }}>{tr('marketing.landing.apps.sub')}</p>
            <ul className="app-list">
              <li><span className="ic">{Icons.users}</span><div><h3>{tr('marketing.apps.parent')}</h3><p>{tr('marketing.landing.apps.parentBody')}</p></div></li>
              <li><span className="ic">{Icons.attendance}</span><div><h3>{tr('marketing.apps.teacher')}</h3><p>{tr('marketing.landing.apps.teacherBody')}</p></div></li>
              <li><span className="ic">{Icons.office}</span><div><h3>{tr('marketing.apps.office')}</h3><p>{tr('marketing.landing.apps.officeBody')}</p></div></li>
            </ul>
            <Link className="b b-primary" href="/apps">{tr('marketing.landing.apps.cta')}</Link>
          </div>
          <div className="phones" aria-label={tr('marketing.mock.caption')}>
            <PhoneMock kind="parent" tr={tr} />
            <PhoneMock kind="teacher" tr={tr} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ coming next */}
      <section className="l-section l-wrap">
        <h2>{tr('marketing.next.title')}</h2>
        <div className="next-grid">
          {NEXT.map(([k, icon]) => (
            <div key={k} className="next-card">
              <div className="ic" style={{ width: 40, height: 40, color: 'var(--accent)', marginBottom: '.6rem' }}>{icon}</div>
              <h3 style={{ marginTop: 0 }}>{tr(`marketing.next.${k}.title`)} <span className="status soon">{tr('marketing.next.soon')}</span></h3>
              <p className="muted" style={{ margin: 0 }}>{tr(`marketing.next.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ trust */}
      <section className="l-section l-wrap">
        <h2>{tr('marketing.trust.title')}</h2>
        <div className="trust">
          {TRUST.map(([k, icon]) => <div key={k}>{icon}<span>{tr(`marketing.trust.${k}`)}</span></div>)}
        </div>
        <p style={{ marginTop: '1.25rem' }}><Link href="/privacy">{tr('marketing.nav.privacy')} →</Link></p>
      </section>

      <div className="l-wrap">
        <section className="cta-band">
          <h2>{tr('marketing.landing.final.title')}</h2>
          <p>{tr('marketing.landing.final.body')}</p>
          <Link className="b b-primary" href="/demo">{tr('marketing.hero.cta')}</Link>
        </section>
      </div>
    </div>
  );
}
