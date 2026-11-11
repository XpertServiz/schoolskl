import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS, siteUrl, urPath } from '@/lib/seo';

/** /sitemap.xml: every public marketing page in English and Urdu, each pointing at its other-language twin (hreflang). School sites and the portal are not listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PATHS.flatMap((p) => {
    const languages = { en: base + p, ur: base + urPath(p) };
    const priority = p === '/' ? 1 : p === '/demo' || p === '/pricing' ? 0.8 : 0.6;
    return [
      { url: base + p, changeFrequency: 'weekly' as const, priority, alternates: { languages } },
      { url: base + urPath(p), changeFrequency: 'weekly' as const, priority: priority - 0.1, alternates: { languages } },
    ];
  });
}
