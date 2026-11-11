'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PageLoader } from './Mark3D';

/**
 * Page-loading splash: when a same-site link is followed or a form is submitted and the next page takes longer than 250 ms, the 3D school
 * mark appears over a dimmed page until the new URL has rendered.
 * DECISION: a client overlay instead of loading.tsx — a route-level Suspense boundary makes Next stream a 200 before the page runs, which
 * turns every permission redirect (need() → 307) into a soft in-page redirect. This keeps the server's behaviour exactly as it was.
 */
export function NavLoader({ label }: { label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafe = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (failsafe.current) clearTimeout(failsafe.current);
    setOn(false);
  };

  // a new URL has rendered → hide
  useEffect(stop, [pathname, search]);

  useEffect(() => {
    const start = () => {
      stop();
      timer.current = setTimeout(() => setOn(true), 250);
      failsafe.current = setTimeout(() => setOn(false), 12000); // never trap anyone behind it
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search) || url.hash && url.pathname === location.pathname) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => { if (!e.defaultPrevented) start(); };
    const onShow = () => stop(); // back/forward cache
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  if (!on) return null;
  return <div className="navload"><PageLoader label={label} /></div>;
}
