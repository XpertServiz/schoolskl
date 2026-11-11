import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';

/**
 * Makes the site installable ("Add to Home Screen") with its own icon, splash colour and a standalone window.
 * On the app host the installed icon opens the sign-in/portal; elsewhere it opens the home page.
 * The service worker (public/sw.js) only adds an offline page — it never caches signed-in data.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = ((await headers()).get('host') ?? '').toLowerCase();
  const isApp = host.startsWith('app.');
  return {
    name: product,
    short_name: product,
    description: 'School management for Pakistan — fees, results, attendance and parent messages.',
    start_url: isApp ? '/portal' : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#23303A', // the splash screen colour on Android
    theme_color: '#23303A',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
