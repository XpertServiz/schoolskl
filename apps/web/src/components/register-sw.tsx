'use client';

import { useEffect } from 'react';

/** Registers the offline-page service worker (production only, so development hot-reload is never confused by a worker). */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined); // failing to register must never break the page
  }, []);
  return null;
}
