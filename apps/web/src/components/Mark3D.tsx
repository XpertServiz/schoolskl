/**
 * The school-house mark as a solid 3D object without WebGL: the same outline stacked N times along the Z axis inside a CSS 3D scene
 * (transform-style: preserve-3d). Back layers are darker, so when it turns you see thickness. Styles live in globals.css (.m3d…).
 * `draw` makes the front face draw itself in (splash); without it the mark is shown whole (loader).
 */
export function Mark3D({ className = '', layers = 8, draw = false }: { className?: string; layers?: number; draw?: boolean }) {
  const paths = (
    <>
      <path className="d1" d="M14 52 60 18l46 34" />
      <path className="d2" d="M24 50v42h72V50" />
      <path className="d3" d="M52 92V68h16v24" />
      <path className="d4" d="M60 18V4" />
      <path className="d5" d="M10 98h100" />
    </>
  );
  return (
    <div className={`m3d ${draw ? 'm3d-draw' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: layers }, (_, i) => {
        const back = layers - 1 - i; // 0 = front face
        const shade = back === 0 ? '#F5A524' : `color-mix(in srgb, #F5A524 ${Math.max(28, 78 - back * 5)}%, #0F1419)`;
        return (
          <svg key={i} viewBox="0 0 120 110" className={back === 0 ? 'm3d-face' : 'm3d-layer'} style={{ transform: `translateZ(${-back * 1.6}px)` }}>
            <g fill="none" stroke={shade} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round">{paths}</g>
            <path className="m3d-flag" d="M60 4l22 7-22 7z" fill={shade} />
          </svg>
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
