import Link from 'next/link';
import { t, type Locale } from '@ilmora/i18n';
import { asLocale } from '@/lib/locale';
import Campus3DLazy from '@/components/landing/Campus3DLazy';
import NightSkyLazy from '@/components/landing/NightSkyLazy';
import { Icons } from '@/components/landing/icons';
import { MediaEmbed } from '@/components/landing/MediaEmbed';
import { PhoneMock } from '@/components/landing/PhoneMock';
import { embedFor } from '@/lib/embed';
import { homeJsonLd, seo } from '@/lib/seo';
import { getSiteContent } from '@/lib/site-content';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const l = asLocale((await params).lang);
  return seo(l, '/');
}

// Few words, big visuals. Every tile is something that works today; nothing here describes an unbuilt feature.
const TILES = [
  ['fees', Icons.fees, ''], ['bus', Icons.bus, 'new'], ['results', Icons.results, ''], ['attendance', Icons.attendance, ''],
  ['ledger', Icons.ledger, ''], ['people', Icons.users, ''], ['urdu', Icons.language, ''], ['offline', Icons.offline, ''],
  ['admissions', Icons.admissions, ''], ['timetable', Icons.timetable, ''],
] as const;

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const locale: Locale = asLocale((await params).lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const { media } = await getSiteContent();
  const demo = media.filter((m) => m.kind === 'demo');
  const reels = media.filter((m) => m.kind === 'reel');
  const title = (m: { title_en: string; title_ur: string }) => (locale === 'ur' && m.title_ur ? m.title_ur : m.title_en);
  const moment = (cls: string, icon: React.ReactNode, b: string, s: string) => (
    <div className={`moment ${cls}`} aria-hidden="true"><span className="ic">{icon}</span><span><b>{tr(b)}</b><small>{tr(s)}</small></span></div>
  );
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: homeJsonLd(locale) }} />
      {/* ------------------------------------------------------------ hero: words, then the 3D campus with live moments round it */}
      <section className="hero">
        <NightSkyLazy />
        <div className="l-wrap">
          <span className="eyebrow">{tr('marketing.landing.eyebrow')}</span>
          <h1>{tr('marketing.hero.title')}</h1>
          <p className="lead">{tr('marketing.v2.lead')}</p>
          <div className="hero-cta">
            <Link className="b b-primary" href="/demo">{tr('marketing.hero.cta')}</Link>
            <Link className="b b-ghost" href="/apps">{tr('marketing.landing.ctaApps')}</Link>
          </div>
          <div className="stage">
            <div className="campus-card">
              <Campus3DLazy label={tr('marketing.landing.campusLabel')} />
              <p className="campus-hint">{tr('marketing.landing.dragHint')}</p>
            </div>
            {moment('m-fee', Icons.fees, 'marketing.v2.moment.feeB', 'marketing.v2.moment.feeS')}
            {moment('m-bus', Icons.bus, 'marketing.v2.moment.busB', 'marketing.v2.moment.busS')}
            {moment('m-att', Icons.attendance, 'marketing.v2.moment.attB', 'marketing.v2.moment.attS')}
            {moment('m-res', Icons.results, 'marketing.v2.moment.resB', 'marketing.v2.moment.resS')}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ tiles */}
      <section id="features" className="l-section l-wrap">
        <h2 className="c reveal">{tr('marketing.v2.tilesTitle')}</h2>
        <div className="tiles">
          {TILES.map(([k, icon, badge], i) => (
            <article key={k} className={`tile reveal${i < 2 ? ' big' : ''}${badge ? ' new' : ''}`} data-badge={badge ? tr('marketing.v2.badgeNew') : undefined}>
              <span className="ic">{icon}</span>
              <h3>{tr(`marketing.v2.tile.${k}`)}</h3>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ demo video + reels (managed in Vendor Console → Website) */}
      {demo.length + reels.length > 0 ? (
        <section className="l-section l-wrap watch">
          <h2 className="c reveal">{tr('site.watch')}</h2>
          {demo.slice(0, 1).map((m) => <MediaEmbed key={m.id} title={title(m)} src={embedFor(m.url)?.src ?? null} href={m.url} portrait={false} play={tr('site.play')} open={tr('site.open')} />)}
          {reels.length ? (
            <div className="reels">
              {reels.map((m) => <MediaEmbed key={m.id} title={title(m)} src={embedFor(m.url)?.src ?? null} href={m.url} portrait play={tr('site.play')} open={tr('site.open')} />)}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------ apps */}
      <section className="l-section apps-band">
        <div className="l-wrap">
          <h2 className="l-head c reveal">{tr('marketing.v2.appsTitle')}</h2>
          <div className="who reveal">
            <span>{Icons.users}{tr('marketing.v2.who.parents')}</span>
            <span>{Icons.attendance}{tr('marketing.v2.who.teachers')}</span>
            <span>{Icons.bus}{tr('marketing.v2.who.drivers')}</span>
            <span>{Icons.office}{tr('marketing.v2.who.office')}</span>
          </div>
          <div className="phones reveal" aria-label={tr('marketing.mock.caption')}>
            <PhoneMock kind="parent" tr={tr} />
            <PhoneMock kind="teacher" tr={tr} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ trust, one line */}
      <section className="l-section l-wrap" style={{ paddingBlock: '1rem 3rem' }}>
        <div className="trust-row reveal">
          <span>{Icons.eyeOff}{tr('marketing.v2.trust.noAds')}</span>
          <span>{Icons.shield}{tr('marketing.v2.trust.noTrack')}</span>
          <span>{Icons.hand}{tr('marketing.v2.trust.consent')}</span>
          <span>{Icons.lock}{tr('marketing.v2.trust.locked')}</span>
        </div>
      </section>

      <div className="l-wrap">
        <section className="cta-band reveal">
          <h2>{tr('marketing.v2.finalTitle')}</h2>
          <Link className="b b-primary" href="/demo">{tr('marketing.hero.cta')}</Link>
        </section>
      </div>
    </div>
  );
}
