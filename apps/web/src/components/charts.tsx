/** Tiny dependency-free SVG charts rendered on the server (no JS shipped). Values come from the database; nothing is computed in the browser. */
const PALETTE = ['#f59e0b', '#14b8a6', '#7c8cff', '#ff7b7b', '#a3e635', '#e879f9'];

export function Bars({ data, fmt, height = 150, title }: { data: { label: string; value: number }[]; fmt: (n: number) => string; height?: number; title: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" role="img" aria-label={title} style={{ width: '100%', height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 3 - 4);
          return <rect key={i} x={i * w + w * 0.15} y={height / 3 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.6 : 0)} rx="0.8" fill={PALETTE[0]}><title>{`${d.label}: ${fmt(d.value)}`}</title></rect>;
        })}
      </svg>
      <figcaption className="muted ltr" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem' }}><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></figcaption>
    </figure>
  );
}

export function Donut({ parts, center, title }: { parts: { label: string; value: number; color?: string }[]; center: string; title: string }) {
  const total = parts.reduce((a, x) => a + x.value, 0);
  const r = 15.9155; // circumference 100
  let acc = 0;
  return (
    <figure style={{ margin: 0, display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 42 42" role="img" aria-label={title} style={{ width: 140, height: 140 }}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="5" />
        {total > 0 ? parts.map((x, i) => {
          const pct = (x.value / total) * 100;
          const el = <circle key={i} cx="21" cy="21" r={r} fill="none" stroke={x.color ?? PALETTE[i % PALETTE.length]} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={25 - acc}><title>{x.label}</title></circle>;
          acc += pct;
          return el;
        }) : null}
        <text x="21" y="22.5" textAnchor="middle" fontSize="5" fontWeight="700" fill="currentColor">{center}</text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '.9rem' }}>
        {parts.map((x, i) => <li key={i}><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: x.color ?? PALETTE[i % PALETTE.length], marginInlineEnd: 6 }} />{x.label}</li>)}
      </ul>
    </figure>
  );
}

/** Horizontal meter: value / of. */
export function Meter({ value, of, label }: { value: number; of: number; label: string }) {
  const pct = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem' }}><span>{label}</span><strong className="ltr">{pct}%</strong></div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 10, borderRadius: 999, background: 'rgba(127,127,127,.2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: PALETTE[1] }} />
      </div>
    </div>
  );
}
