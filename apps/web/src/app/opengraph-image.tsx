import { ImageResponse } from 'next/og';

// The picture shown when the site is shared on WhatsApp, Facebook, LinkedIn, X … (1200×630). Built once at deploy time.
export const alt = 'School management for Pakistan';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, color: '#F4F6F9',
        background: 'radial-gradient(60% 80% at 80% 20%, #3a2a0e 0%, #0b1424 55%, #02040b 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <svg width="96" height="88" viewBox="0 0 120 110"><g fill="none" stroke="#F5A524" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round"><path d="M14 52 60 18l46 34M24 50v42h72V50M52 92V68h16v24M60 18V4M10 98h100" /></g><path d="M60 4l22 7-22 7z" fill="#F5A524" /></svg>
          <div style={{ fontSize: 64, fontWeight: 800 }}>{product}</div>
        </div>
        <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.05, marginTop: 36, letterSpacing: -2 }}>Your school, running itself.</div>
        <div style={{ fontSize: 34, color: '#AEB8C4', marginTop: 28 }}>Fees · Results · Attendance · School bus — in Urdu and English</div>
      </div>
    ),
    size,
  );
}
