'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

const NightSky = dynamic(() => import('./NightSky'), { ssr: false, loading: () => null });

/**
 * The hero's night sky, loaded after the page (three.js is shared with the 3D campus, so it is one download). Until it draws, and if
 * WebGL is missing, the CSS sky (.sky-fallback: gradient + static stars) shows; the canvas fades in over it when ready.
 */
export default function NightSkyLazy() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className="hero-sky" data-ready={ready ? '1' : '0'} aria-hidden="true">
      <div className="sky-fallback" />
      <NightSky onReady={onReady} />
      <div className="sky-fade" />
    </div>
  );
}
