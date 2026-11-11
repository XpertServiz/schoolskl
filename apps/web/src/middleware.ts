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
  const internal = pathname.startsWith('/site/') || pathname.startsWith('/vendor') || pathname.startsWith('/portal') || pathname === '/m' || pathname.startsWith('/m/');

  switch (k.kind) {
    case 'root':
      // Path routing (NEXT_PUBLIC_ROUTING=path, e.g. on a *.vercel.app address with no subdomains): the portal, the vendor console and
      // school sites share the root host. Same pages, same session refresh, same database checks — only the address shape differs.
      if (process.env.NEXT_PUBLIC_ROUTING === 'path') {
        if (pathname === '/portal' || pathname.startsWith('/portal/') || pathname === '/vendor' || pathname.startsWith('/vendor/')) {
          return refreshSession(req, NextResponse.next());
        }
        const site = /^\/s\/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])(\/.*)?$/.exec(pathname);
        if (site) return rewrite(req, `/site/${site[1]}${site[2] ?? ''}`, search); // the page resolves the bare slug
      }
      // DECISION (CPU): public marketing pages are static, one copy per language under /m/<lang>/…; the visitor's cookie picks the copy.
      // No database or auth call here — a cookie read and a rewrite.
      if (!internal) return rewrite(req, `/m/${req.cookies.get('locale')?.value === 'ur' ? 'ur' : 'en'}${pathname === '/' ? '' : pathname}`, search);
      // DECISION: internal prefixes on the root host get a small static 404 page, not a rewrite to the rendered /not-found route.
      // When a server action redirects, Next pre-renders the target with an internal fetch to the server's own origin (`next start` →
      // http://localhost:PORT), which loses the app./vendor. host and lands here. If that fetch gets a React Server Component response
      // (the rendered not-found page), Next shows it — so every portal form ended on "page not found" after saving. A non-RSC answer
      // makes Next fall back to a client-side redirect, which goes through the right host. (Middleware cannot tell those internal
      // fetches apart: Next strips the `rsc` header before middleware runs.) Still fails closed — nothing internal is served here.
      return new NextResponse(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
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

const NOT_FOUND_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
  '<title>404</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16202b;color:#e8eef4;font-family:system-ui,sans-serif;text-align:center}</style></head>' +
  '<body><main><h1>404</h1><p>We couldn\'t find this page.</p><p lang="ur" dir="rtl">ہمیں یہ صفحہ نہیں ملا۔</p><p><a href="/" style="color:#ffb547">Home</a></p></main></body></html>';

function rewrite(req: NextRequest, path: string, search: string) {
  return NextResponse.rewrite(new URL(`${path}${search}`, req.url));
}

// Static/PWA files are served as-is on every host (never rewritten into /portal, /vendor or /site), and middleware does not even start
// for them: _next assets, /api, the PWA/robots files, and any path ending in a file extension (images, fonts, .webmanifest, .js …).
export const config = { matcher: ['/((?!_next/|api/|icons/|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.[A-Za-z0-9]{1,8}$).*)'] };
