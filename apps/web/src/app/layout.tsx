import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { t } from '@ilmora/i18n';
import { NavLoader } from '@/components/nav-loader';
import { RegisterSW } from '@/components/register-sw';
import './globals.css';

// DECISION: the product name is never hard-coded (CLAUDE.md header). It comes from NEXT_PUBLIC_PRODUCT_NAME until
// the Vendor Console → Brand settings exist (Phase 1 follow-up).
const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmora';

export const metadata: Metadata = {
  title: { default: product, template: `%s · ${product}` },
  description: 'School management for Pakistan — fees, results, attendance and parent messages, in English and Urdu.',
  applicationName: product,
  icons: { apple: '/icons/apple-touch-180.png' },
  // Google Search Console: set GOOGLE_SITE_VERIFICATION (the content=… value of the HTML-tag method) to prove ownership; absent = no tag
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  appleWebApp: { capable: true, title: product, statusBarStyle: 'black-translucent' },
};

// the browser chrome / splash colour follows the Slate background
export const viewport: Viewport = { themeColor: '#23303A', width: 'device-width', initialScale: 1 };

// DECISION (CPU): the root layout reads NO cookies, so public pages can be static. The page language/direction still follows the
// `locale` cookie: this runs before first paint and sets <html lang dir>; every surface also wraps its content in <div lang dir>
// (server-rendered from the same cookie or the URL), so without JavaScript the text is still in the right direction.
const LOCALE_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )locale=(ur|en)(?:;|$)/),l=m?m[1]:'en',d=document.documentElement;if(location.pathname==='/ur'||location.pathname.indexOf('/ur/')===0)l='ur';d.lang=l;d.dir=l==='ur'?'rtl':'ltr'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: LOCALE_SCRIPT }} /></head>
      <body>
        <main id="main">{children}</main>
        <Suspense fallback={null}><NavLoader label={`${t('en', 'app.loading')} / ${t('ur', 'app.loading')}`} /></Suspense>
        <RegisterSW />
      </body>
    </html>
  );
}
