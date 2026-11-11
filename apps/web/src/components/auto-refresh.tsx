'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-fetches the current server page every `seconds` (a soft refresh: same URL, same session, same checks — only new data).
 * DECISION (CPU): replaces <meta http-equiv="refresh">, which re-rendered the whole page even in a background tab. This one
 *  - never runs while the tab is hidden, and refreshes once straight away when the person comes back (if the data is stale);
 *  - stops when the component unmounts (leaving the page, or the trip ended so the parent page stops rendering it).
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const ms = Math.max(15, seconds) * 1000;
    let last = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { if (!document.hidden) { last = Date.now(); router.refresh(); } };
    const start = () => { if (!timer) timer = setInterval(tick, ms); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      if (Date.now() - last >= ms) tick();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [router, seconds]);
  return null;
}
