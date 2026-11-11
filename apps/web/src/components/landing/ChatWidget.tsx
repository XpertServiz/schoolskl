'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { chipLabel, reply, STARTER_CHIPS, type Loc, type Reply } from '@ilmora/assistant';

interface Msg { who: 'bot' | 'me'; text: string; link?: Reply['link'] }

/**
 * Website helper. It answers from the reviewed knowledge base in @ilmora/assistant — in the browser, with no API, no cost and nothing sent
 * anywhere; typed questions are not stored. The chat opens only on request (nothing loads from third parties).
 */
export function ChatWidget({ lang, whatsapp, name }: { lang: Loc; whatsapp: string | null; name: string }) {
  const ur = lang === 'ur';
  const L = (en: string, u: string) => (ur ? u : en);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'bot', text: L('Salam! I am Aiman. Ask me about pricing, features, the app or a free demo — in English, Urdu or Roman Urdu.', 'السلام علیکم! میں ایمن ہوں۔ قیمت، خصوصیات، ایپ یا مفت ڈیمو کے بارے میں پوچھیں — انگریزی، اردو یا رومن اردو میں۔') }]);
  const [chips, setChips] = useState<string[]>(STARTER_CHIPS);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);

  const ask = (q: string) => {
    const text = q.trim().slice(0, 300);
    if (!text || busy) return;
    setMsgs((m) => [...m, { who: 'me', text }]);
    setBusy(true);
    const r = reply(text, lang);
    setTimeout(() => { setMsgs((m) => [...m, { who: 'bot', text: r.text, link: r.link }]); setChips(r.chips); setBusy(false); }, 350);
  };

  return (
    <>
      {open ? (
        <section className="chat" role="dialog" aria-label={L('Chat with Aiman', 'ایمن سے بات')}>
          <header className="chat-h">
            <img src="/aiman.webp" alt="" width={36} height={36} />
            <div><strong>{L('Aiman', 'ایمن')}</strong><small>{name} · {L('usually replies instantly', 'فوراً جواب دیتی ہے')}</small></div>
            <button type="button" onClick={() => setOpen(false)} aria-label={L('Close chat', 'چیٹ بند کریں')}>✕</button>
          </header>
          <div className="chat-b" aria-live="polite">
            {msgs.map((m, i) => (
              <p key={i} className={`bub ${m.who}`}>
                {m.text}
                {m.link ? <><br /><Link href={m.link.href} className="chat-link">{m.link.label} →</Link></> : null}
              </p>
            ))}
            {busy ? <p className="bub bot dots" aria-label="…">• • •</p> : null}
            <div ref={end} />
          </div>
          <div className="chat-chips">
            {chips.map((c) => c === 'contact' && whatsapp
              ? <a key={c} href={whatsapp} target="_blank" rel="noopener noreferrer">💬 {chipLabel(c, lang)}</a>
              : <button key={c} type="button" onClick={() => ask(chipLabel(c, lang))}>{chipLabel(c, lang)}</button>)}
          </div>
          <form className="chat-f" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); ask(String(f.get('q') ?? '')); e.currentTarget.reset(); }}>
            <input name="q" autoComplete="off" maxLength={300} placeholder={L('Type your question…', 'اپنا سوال لکھیں…')} aria-label={L('Your question', 'آپ کا سوال')} />
            <button type="submit" disabled={busy}>{L('Send', 'بھیجیں')}</button>
          </form>
        </section>
      ) : null}
      <button type="button" className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label={L('Chat with Aiman', 'ایمن سے بات')} aria-expanded={open}>
        <img src="/aiman.webp" alt="" width={52} height={52} />
      </button>
    </>
  );
}
