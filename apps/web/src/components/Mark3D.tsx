/**
 * The Ilmified logo mark as a solid 3D object without WebGL: the same image stacked N times along the Z axis inside a CSS 3D scene
 * (transform-style: preserve-3d). Back layers are darker, so when it turns you see thickness. Styles live in globals.css (.m3d…).
 * `draw` makes the front face fade and scale in (splash); without it the mark is shown whole (loader).
 */
export function Mark3D({ className = '', layers = 8, draw = false }: { className?: string; layers?: number; draw?: boolean }) {
  return (
    <div className={`m3d ${draw ? 'm3d-draw' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: layers }, (_, i) => {
        const back = layers - 1 - i; // 0 = front face; the back copies are darker, so a turn shows thickness
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src="/logo-mark.png" alt="" draggable={false} className={back === 0 ? 'm3d-face' : 'm3d-layer'}
            style={{ transform: `translateZ(${-back * 1.6}px)`, filter: back === 0 ? undefined : `brightness(${Math.max(0.28, 0.78 - back * 0.07)})` }} />
        );
      })}
    </div>
  );
}

/** Page-loading screen (shown by components/nav-loader.tsx): the 3D mark turning slowly and three dots, faded in so it never flashes. */
export function PageLoader({ label }: { label: string }) {
  return (
    <div className="pl" role="status" aria-live="polite">
      <div className="pl-stage"><Mark3D className="pl-obj" layers={8} /></div>
      <div className="pl-dots" aria-hidden="true"><i /><i /><i /></div>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
