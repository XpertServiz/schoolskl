'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

/** Static stand-in: shown while three.js loads, with no WebGL, and with JS off. Same house as the app icon. */
export function CampusIllustration({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 200 160" role="img" aria-label={label} className="campus-fallback">
      <ellipse cx="100" cy="136" rx="84" ry="14" fill="#2d3d49" />
      <rect x="52" y="76" width="96" height="56" rx="3" fill="#f1ead8" />
      <path d="M44 78 100 38l56 40z" fill="#d9831f" />
      <rect x="92" y="100" width="16" height="32" fill="#5a3d2b" />
      <rect x="64" y="90" width="14" height="14" fill="#7fb4d6" /><rect x="122" y="90" width="14" height="14" fill="#7fb4d6" />
      <path d="M100 38V14" stroke="#ccc" strokeWidth="2" /><path d="M100 14l22 6-22 6z" fill="#f5a524" />
    </svg>
  );
}

const Campus3D = dynamic(() => import('./Campus3D'), { ssr: false, loading: () => null });

/**
 * remember: paint the name of the school this browser last signed in to on the front wall (kept in localStorage by RememberSchool; a
 * school's name is public, so nothing private is stored). The scene is built after that lookup so it does not flash and rebuild.
 */
export default function Campus3DLazy({ label, remember = false }: { label: string; remember?: boolean }) {
  const [name, setName] = useState<string | undefined>(undefined);
  const [looked, setLooked] = useState(!remember);
  useEffect(() => {
    if (!remember) return;
    try { setName(window.localStorage.getItem('lastSchool')?.slice(0, 60) || undefined); } catch { /* blocked storage: no banner */ }
    setLooked(true);
  }, [remember]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className="campus-stage" data-ready={ready ? '1' : '0'}>
      {/* the illustration is what you see until the 3D scene has drawn its first frame (or forever, if WebGL is unavailable) */}
      <CampusIllustration label={label} />
      {failed || !looked ? null : <div className="campus-canvas"><Campus3D label={label} onFail={onFail} onReady={onReady} name={name} /></div>}
    </div>
  );
}
