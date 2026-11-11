'use client';

import { useEffect, useRef, useState } from 'react';

/** Shares THIS phone's position (the bus) while a trip is open. Foreground only; stops when the page closes. No child is ever located. */
export function TripGps({ tripId, send, label }: { tripId: string; send: (trip: string, points: { lat: number; lng: number; accuracy: number | null; at: string }[]) => Promise<void>; label: string }) {
  const [state, setState] = useState<'wait' | 'on' | 'denied' | 'none'>('wait');
  const buf = useRef<{ lat: number; lng: number; accuracy: number | null; at: string }[]>([]);
  useEffect(() => {
    if (!('geolocation' in navigator)) { setState('none'); return; }
    const flush = () => { const pts = buf.current.splice(0); if (pts.length) send(tripId, pts).catch(() => buf.current.unshift(...pts)); };
    const id = navigator.geolocation.watchPosition(
      (pos) => { setState('on'); buf.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, at: new Date(pos.timestamp).toISOString() }); },
      () => setState('denied'), { enableHighAccuracy: true, maximumAge: 5000 },
    );
    const t = setInterval(flush, 15000);
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request: (k: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { navigator.geolocation.clearWatch(id); clearInterval(t); flush(); lock?.release().catch(() => {}); };
  }, [tripId, send]);
  return <p role="status" className="notice">{label}: {state === 'on' ? '●' : state === 'denied' ? '✗ (location blocked)' : state === 'none' ? '✗' : '…'}</p>;
}

/** QR scanner using the browser's built-in BarcodeDetector (Chrome/Android). Falls back to typing the code. */
export function QrScan({ tripId, scan, labels }: { tripId: string; scan: (trip: string, code: string) => Promise<string>; labels: { start: string; stop: string; manual: string; send: string; unsupported: string } }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const last = useRef({ code: '', at: 0 });
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  useEffect(() => {
    if (!on) return;
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const Det = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const det = new Det({ formats: ['qr_code'] });
        while (!stop) {
          const found = video.current ? await det.detect(video.current).catch(() => []) : [];
          const code = found[0]?.rawValue;
          if (code && (code !== last.current.code || Date.now() - last.current.at > 4000)) { last.current = { code, at: Date.now() }; setMsg(await scan(tripId, code)); }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch { setMsg('camera blocked'); setOn(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on, tripId, scan]);
  return (
    <div className="card">
      {supported ? <button type="button" className="btn" onClick={() => setOn((x) => !x)}>{on ? labels.stop : labels.start}</button> : <p className="muted">{labels.unsupported}</p>}
      {on ? <video ref={video} muted playsInline style={{ width: '100%', maxWidth: 360, borderRadius: 12, marginTop: '.5rem' }} /> : null}
      <form className="inline" style={{ marginTop: '.5rem' }} onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const v = (new FormData(f).get('code') as string) ?? ''; if (v) setMsg(await scan(tripId, v)); f.reset(); }}>
        <input name="code" placeholder={labels.manual} className="ltr" autoComplete="off" />
        <button className="btn secondary small">{labels.send}</button>
      </form>
      {msg ? <p role="status" aria-live="polite"><strong>{msg}</strong></p> : null}
    </div>
  );
}
