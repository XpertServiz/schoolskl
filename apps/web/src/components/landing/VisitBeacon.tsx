'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const PAGES = new Set(['/', '/apps', '/pricing', '/privacy', '/demo']);

/**
 * Counts a visit to the public site — nothing else. Sends only {page, language, "first page of this session?"} to /api/visit, which adds
 * to a daily total. No cookie, no ID, no IP address is stored. It respects the browser's Do-Not-Track setting (then nothing is sent),
 * and the "session" flag lives in sessionStorage (gone when the tab closes).
 */
export function VisitBeacon({ lang }: { lang: 'en' | 'ur' }) {
  const pathname = usePathname() ?? '/';
  useEffect(() => {
    try {
      if (navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1') return;
      const page = pathname.replace(/^\/ur(?=\/|$)/, '') || '/';
      if (!PAGES.has(page)) return;
      const first = !sessionStorage.getItem('visited');
      sessionStorage.setItem('visited', '1');
      const body = JSON.stringify({ path: page, lang, first });
      if (!navigator.sendBeacon?.('/api/visit', new Blob([body], { type: 'application/json' }))) void fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } });
    } catch { /* counting must never break a page */ }
  }, [pathname, lang]);
  return null;
}
