import type { MetadataRoute } from 'next';

// CLAUDE.md §14: portals, admin and API are never indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/app', '/admin', '/portal', '/vendor', '/api'] }] };
}
