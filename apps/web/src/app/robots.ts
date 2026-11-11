import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

// CLAUDE.md §14: portals, admin and API are never indexed. Public pages (home, apps, pricing, privacy, demo, Urdu /ur, school sites /s/<slug>)
// stay crawlable; the internal rewrite targets (/m/, /site/) are never linked but are disallowed too so bots don't burn renders on them.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/app', '/admin', '/dashboard', '/portal', '/vendor', '/api', '/m/', '/site/'] }], sitemap: `${siteUrl()}/sitemap.xml`, host: siteUrl() };
}
