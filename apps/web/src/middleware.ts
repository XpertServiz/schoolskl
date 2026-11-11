import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost } from '@ilmora/core';
import { refreshSession } from '@/lib/supabase/middleware';

// Host → route group. Route groups don't appear in URLs, so each surface lives under its own path prefix:
//   ilmora.pk            → (marketing)        /
//   vendor.ilmora.pk     → (vendor)           /vendor/*
//   app.ilmora.pk        → (app)              /portal/*   (tenant picker for multi-school users)
//   {slug}.ilmora.pk     → (tenant-site)      /site/{host}/*   (public school website; tenant resolved in the page)
//   custom domain        → (tenant-site)      /site/{host}/*
// The middleware never decides WHICH tenant — it only forwards the host. The page asks the database
// (public.resolve_tenant); the database is the authority on tenancy, not the router.
export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost';
  const { pathname, search } = req.nextUrl;
  const k = classifyHost(host, root);

  // never let a caller reach the internal prefixes directly via the wrong host
  const internal = pathname.startsWith('/site/') || pathname.startsWith('/vendor') || pathname.startsWith('/portal');

  switch (k.kind) {
    case 'root':
      return internal ? NextResponse.rewrite(new URL('/not-found', req.url)) : NextResponse.next();
    case 'reserved': {
      // signed-in surfaces refresh the session so server-rendered pages never see an expired token
      if (k.label === 'vendor') return refreshSession(req, rewrite(req, pathname.startsWith('/vendor') ? pathname : `/vendor${pathname === '/' ? '' : pathname}`, search));
      if (k.label === 'app') return refreshSession(req, rewrite(req, pathname.startsWith('/portal') ? pathname : `/portal${pathname === '/' ? '' : pathname}`, search));
      return NextResponse.rewrite(new URL('/not-found', req.url));
    }
    case 'tenant-subdomain':
    case 'custom-domain': {
      const h = k.kind === 'tenant-subdomain' ? `${k.slug}.${root}` : k.host;
      if (internal) return NextResponse.rewrite(new URL('/not-found', req.url));
      return rewrite(req, `/site/${encodeURIComponent(h)}${pathname === '/' ? '' : pathname}`, search);
    }
  }
}

function rewrite(req: NextRequest, path: string, search: string) {
  return NextResponse.rewrite(new URL(`${path}${search}`, req.url));
}

// Static/PWA files are served as-is on every host (never rewritten into /portal, /vendor or /site).
export const config = { matcher: ['/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|sw.js|offline.html|icon.png|icons/).*)'] };
