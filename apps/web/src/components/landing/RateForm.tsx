'use client';

import { useState } from 'react';

/** Visitor review form. Goes to /api/review; shown on the site only after the super admin approves it. */
export function RateForm({ lang }: { lang: 'en' | 'ur' }) {
  const ur = lang === 'ur';
  const L = (en: string, u: string) => (ur ? u : en);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  return (
    <form className="rate-form" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setState('sending');
      try {
        const r = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(f)) });
        setState(r.ok ? 'done' : 'error');
      } catch { setState('error'); }
    }}>
      <h3 style={{ margin: 0 }}>{L('Used it? Rate us', 'استعمال کیا؟ ہمیں ریٹ کریں')}</h3>
      {state === 'done' ? <p role="status">{L('Thank you! Your review will appear after we check it.', 'شکریہ! جانچ کے بعد آپ کا تبصرہ نظر آئے گا۔')}</p> : (
        <>
          <input name="name" required minLength={2} maxLength={80} placeholder={L('Your name', 'آپ کا نام')} aria-label={L('Your name', 'آپ کا نام')} />
          <input name="school" maxLength={120} placeholder={L('School (optional)', 'اسکول (اختیاری)')} aria-label={L('School', 'اسکول')} />
          <select name="rating" defaultValue="5" aria-label={L('Rating', 'ریٹنگ')}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select>
          <textarea name="comment" required minLength={5} maxLength={600} rows={3} placeholder={L('What did you like or want improved?', 'کیا اچھا لگا یا کیا بہتر ہو؟')} aria-label={L('Comment', 'تبصرہ')} />
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', opacity: 0, pointerEvents: 'none' }} />
          <button className="b b-primary" disabled={state === 'sending'}>{L('Send review', 'تبصرہ بھیجیں')}</button>
          {state === 'error' ? <p role="alert">{L('Could not send — please try again later.', 'بھیجا نہ جا سکا — بعد میں دوبارہ کوشش کریں۔')}</p> : null}
        </>
      )}
    </form>
  );
}
