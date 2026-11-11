import { t, type Locale } from '@ilmora/i18n';
import { asLocale } from '@/lib/locale';
import { seo } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const l = asLocale((await params).lang);
  return seo(l, '/privacy', t(l, 'marketing.nav.privacy'));
}

/**
 * Product promises, each backed by something enforced in code: tenant isolation is database RLS, tracking needs recorded consent, no ad/tracker
 * scripts are loaded (the CSP-style headers in next.config.mjs deny camera/microphone), learning notes are never labels.
 * This is NOT a legal privacy policy — that needs counsel's review before launch and is listed as an open item.
 */
// (no "can we export our data?" entry until a school-facing export exists — never promise what the product does not do yet)
const POINTS = ['isolation', 'consent', 'noAds', 'noLabels', 'humans', 'access'] as const;

export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const locale: Locale = asLocale((await params).lang);
  const tr = (k: string) => t(locale, k);
  return (
    <div className="wrap">
      <h1>{tr('marketing.privacy.title')}</h1>
      <p className="muted">{tr('marketing.privacy.intro')}</p>
      <dl>
        {POINTS.map((k) => (
          <div key={k} className="card" style={{ marginBottom: '1rem' }}>
            <dt><strong>{tr(`marketing.privacy.${k}.q`)}</strong></dt>
            <dd style={{ margin: '.5rem 0 0' }}>{tr(`marketing.privacy.${k}.a`)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{tr('marketing.privacy.legal')}</p>
    </div>
  );
}
