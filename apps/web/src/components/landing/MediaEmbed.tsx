'use client';

import { useState } from 'react';

/**
 * A video card that loads NOTHING from the video platform until the visitor presses Play (click-to-play): no third-party scripts,
 * cookies or trackers on page load — matching the privacy promise — and a lighter page. After Play, the platform's own player opens in a
 * sandboxed iframe. Reels are portrait (9:16), the demo video is landscape (16:9). Unrecognised links show an "open" button instead.
 */
export function MediaEmbed({ title, src, href, portrait, play, open }: { title: string; src: string | null; href: string; portrait: boolean; play: string; open: string }) {
  const [on, setOn] = useState(false);
  return (
    <figure className={`media ${portrait ? 'media-reel' : 'media-demo'}`}>
      <div className="media-frame">
        {on && src ? (
          <iframe src={src} title={title} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
        ) : (
          <div className="media-poster">
            {src ? (
              <button type="button" className="media-play" onClick={() => setOn(true)} aria-label={`${play}: ${title}`}><span aria-hidden="true">▶</span></button>
            ) : (
              <a className="b b-primary" href={href} target="_blank" rel="noopener noreferrer">{open} ↗</a>
            )}
          </div>
        )}
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
