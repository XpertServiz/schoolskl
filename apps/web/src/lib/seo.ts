import type { Metadata } from 'next';
import { t, type Locale } from '@ilmora/i18n';

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';

/** Public address of the site (no trailing slash). Set NEXT_PUBLIC_SITE_URL to the real domain when there is one. */
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://schoolskl.vercel.app').replace(/\/$/, '');

/** The marketing pages that search engines should index; Urdu versions live at /ur/… (English at the plain path). */
export const PUBLIC_PATHS = ['/', '/apps', '/pricing', '/privacy', '/demo'] as const;
export const urPath = (path: string) => (path === '/' ? '/ur' : `/ur${path}`);

/**
 * SEO metadata for one public page: title, description, canonical address, English/Urdu alternates (hreflang), and the share card
 * (Open Graph + Twitter, image from app/opengraph-image.tsx). `title` omitted = the home page's full title.
 */
export function seo(lang: Locale, path: string, title?: string): Metadata {
  const description = t(lang, 'seo.description');
  const url = lang === 'ur' ? urPath(path) : path;
  const full = title ? `${title} · ${product}` : `${product} — ${t(lang, 'seo.title')}`;
  return {
    metadataBase: new URL(siteUrl()),
    title: title ?? { absolute: full },
    description,
    alternates: { canonical: url, languages: { en: path, ur: urPath(path), 'x-default': path } },
    openGraph: { type: 'website', siteName: product, title: full, description, url, images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: full }], locale: lang === 'ur' ? 'ur_PK' : 'en_PK', alternateLocale: [lang === 'ur' ? 'en_PK' : 'ur_PK'] },
    twitter: { card: 'summary_large_image', title: full, description, images: ['/opengraph-image'] },
    robots: { index: true, follow: true },
  };
}

/** Structured data for the home page (Organization + SoftwareApplication), so Google can show a rich result. */
export function homeJsonLd(lang: Locale): string {
  const base = siteUrl();
  const data = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: product, url: base, logo: `${base}/icons/icon-512.png` },
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: product, applicationCategory: 'EducationalApplication', operatingSystem: 'Web, Android',
      description: t(lang, 'seo.description'), inLanguage: ['en', 'ur'], url: base, offers: { '@type': 'Offer', availability: 'https://schema.org/PreOrder', priceCurrency: 'PKR' } },
  ];
  return JSON.stringify(data).replace(/</g, '\\u003c'); // never let data close the script tag
}
