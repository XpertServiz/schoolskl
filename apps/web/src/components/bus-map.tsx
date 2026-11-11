/**
 * A bus position on a map with no API key and no script: OpenStreetMap's embed page in an iframe, plus a link that opens the same point in
 * Google Maps (the phone's map app). DECISION: OSM embed until the school/vendor provides a Google Maps API key; swapping it is one URL.
 * Only the BUS position is ever passed here — never a child's.
 */
export function BusMap({ lat, lng, label, height = 280 }: { lat: number; lng: number; label: string; height?: number }) {
  const d = 0.008; // ~900 m either side
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((x) => x.toFixed(5)).join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`;
  return (
    <figure className="busmap" style={{ margin: 0 }}>
      <iframe title={label} src={src} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height, border: 0, borderRadius: 12 }} />
      <figcaption className="muted ltr" style={{ fontSize: '.85rem' }}>
        <a href={`https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`} target="_blank" rel="noopener noreferrer">Google Maps ↗</a> · © OpenStreetMap
      </figcaption>
    </figure>
  );
}

/** "5 min ago"-style age, in the reader's language, for a bus position timestamp. */
export function ageText(iso: string | null | undefined, locale: 'en' | 'ur'): string {
  if (!iso) return '';
  const rtf = new Intl.RelativeTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', { numeric: 'auto' });
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  return Math.abs(s) < 60 ? rtf.format(s, 'second') : Math.abs(s) < 3600 ? rtf.format(Math.round(s / 60), 'minute') : rtf.format(Math.round(s / 3600), 'hour');
}
