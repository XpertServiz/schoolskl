/**
 * Splash screen: the school-house mark draws itself on the Slate background, then the overlay fades away on its own (pure CSS, ~2 s).
 *  - no JavaScript needed: the fade is a CSS animation, so a blocked script can never trap someone behind it;
 *  - shown once per browser session: a tiny inline script marks later visits with data-splash="off" before first paint;
 *  - skipped entirely for prefers-reduced-motion;
 *  - aria-hidden and pointer-events:none, so it never interferes with reading, search engines or clicks.
 */
export function Splash({ name }: { name: string }) {
  const script = `try{var d=document.documentElement;if(sessionStorage.getItem('splash')||matchMedia('(prefers-reduced-motion: reduce)').matches){d.setAttribute('data-splash','off')}else{sessionStorage.setItem('splash','1')}}catch(e){}`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: script }} />
      <div id="splash" aria-hidden="true">
        <svg viewBox="0 0 120 110" width="132" height="121" className="splash-mark">
          <g fill="none" stroke="#F5A524" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
            <path className="s1" d="M14 52 60 18l46 34" />
            <path className="s2" d="M24 50v42h72V50" />
            <path className="s3" d="M52 92V68h16v24" />
            <path className="s4" d="M60 18V4" />
            <path className="s5" d="M10 98h100" />
          </g>
          <path className="splash-flag" d="M60 4l22 7-22 7z" fill="#F5A524" />
        </svg>
        <p className="splash-name">{name}</p>
      </div>
    </>
  );
}
