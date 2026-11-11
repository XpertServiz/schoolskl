import { cookies } from 'next/headers';
import { t, type Locale } from '@ilmora/i18n';

export const metadata = { title: 'Book a demo' };

/** Plain HTML form → /api/demo (no client JS needed, works on the weakest phone). The hidden "website" field is a honeypot for bots. */
export default async function Demo({ searchParams }: { searchParams: Promise<{ sent?: string; err?: string }> }) {
  const locale: Locale = (await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en';
  const tr = (k: string) => t(locale, k);
  const sp = await searchParams;
  return (
    <div className="wrap">
      <h1>{tr('marketing.demo.title')}</h1>
      {sp.sent ? <p role="status" className="flash ok">{tr('marketing.demo.thanks')}</p> : null}
      {sp.err ? <p role="alert" className="flash err">{tr(`marketing.demo.err.${sp.err === 'phone' ? 'phone' : sp.err === 'fields' ? 'fields' : 'failed'}`)}</p> : null}
      <form method="post" action="/api/demo" className="form card">
        <label>{tr('marketing.demo.name')}<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>{tr('marketing.demo.school')}<input name="school" required minLength={2} maxLength={160} autoComplete="organization" /></label>
        <label>{tr('marketing.demo.city')}<input name="city" maxLength={80} autoComplete="address-level2" /></label>
        <label>{tr('auth.phone')}<input name="phone" type="tel" required autoComplete="tel" className="ltr" placeholder="0300 1234567" /></label>
        <label>{tr('marketing.demo.email')}<input name="email" type="email" maxLength={160} autoComplete="email" className="ltr" /></label>
        <label>{tr('marketing.demo.size')}
          <select name="size"><option value="">—</option><option value="lt300">&lt; 300</option><option value="300_1000">300 – 1,000</option><option value="1000_3000">1,000 – 3,000</option><option value="gt3000">3,000+</option></select>
        </label>
        <label>{tr('marketing.demo.message')}<textarea name="message" maxLength={1000} rows={3} /></label>
        <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: '-9999px' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <input type="hidden" name="locale" value={locale} />
        <button className="btn">{tr('marketing.demo.send')}</button>
      </form>
    </div>
  );
}
