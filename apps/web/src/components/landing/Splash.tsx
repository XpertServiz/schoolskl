import { Mark3D } from '../Mark3D';

/**
 * Opening splash: the school-house mark spins in as a solid 3D object (stacked layers in a CSS 3D scene), an orbit ring sweeps round it,
 * the name rises and a progress line fills — then the overlay fades on its own (~2.4 s). Same mark and motion as the page loader and the
 * mobile app's in-app splash.
 *  - no JavaScript needed: everything is CSS animation, so a blocked script can never trap someone behind it;
 *  - once per browser session: a tiny inline script marks later visits with data-splash="off" before first paint;
 *  - skipped for prefers-reduced-motion; aria-hidden and pointer-events:none, so it never blocks reading, search engines or clicks.
 */
export function Splash({ name }: { name: string }) {
  const script = `try{var d=document.documentElement;if(sessionStorage.getItem('splash')||matchMedia('(prefers-reduced-motion: reduce)').matches){d.setAttribute('data-splash','off')}else{sessionStorage.setItem('splash','1')}}catch(e){}`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: script }} />
      <div id="splash" aria-hidden="true">
        <div className="sp-glow" />
        <div className="sp-stage">
          <div className="sp-orbit" />
          <Mark3D className="sp-obj" layers={12} draw />
        </div>
        <p className="splash-name">{name}</p>
        <div className="sp-bar"><span /></div>
      </div>
    </>
  );
}
