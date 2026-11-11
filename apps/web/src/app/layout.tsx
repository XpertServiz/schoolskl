import type { Metadata, Viewport } from 'next';
import { RegisterSW } from '@/components/register-sw';
import { cookies } from 'next/headers';
import { dirOf, t, type Locale } from '@ilmora/i18n';
import './globals.css';

// DECISION: the product name is never hard-coded (CLAUDE.md header). It comes from NEXT_PUBLIC_PRODUCT_NAME until
// the Vendor Console → Brand settings exist (Phase 1 follow-up).
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmora';

export const metadata: Metadata = {
  title: { default: product, template: `%s · ${product}` },
  description: 'School management for Pakistan — fees, results, attendance and parent messages, in English and Urdu.',
  applicationName: product,
  icons: { apple: '/icons/apple-touch-180.png' },
  appleWebApp: { capable: true, title: product, statusBarStyle: 'black-translucent' },
};

// the browser chrome / splash colour follows the Slate background
export const viewport: Viewport = { themeColor: '#23303A', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = (await cookies()).get('locale')?.value;
  const locale: Locale = c === 'ur' ? 'ur' : 'en';
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <a className="skip" href="#main">{t(locale, 'common.skip')}</a>
        <main id="main">{children}</main>
        <RegisterSW />
      </body>
    </html>
  );
}
