import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { BusMap, ageText } from '@/components/bus-map';
import { need, portal } from '@/lib/portal';

export const metadata = { title: 'Live buses', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Every bus on a trip right now, refreshed every 60 s while a bus is out and the tab is visible. Bus positions only (tracking.live.view). */
export default async function LiveBuses() {
  const p = await portal();
  need(p, 'tracking.live.view');
  const { data } = p.flag('saferoute') ? await p.sb.rpc('live_trips') : { data: [] };
  type Live = { trip_id: string; route_name: string; vehicle_label: string | null; direction: string; lat: number | null; lng: number | null; position_at: string | null; riders: number; on_board: number };
  const trips = (data ?? []) as Live[];
  return (
    <>
      {trips.length ? <AutoRefresh seconds={60} /> : null}
      <p className="inline"><Link href="/portal/transport">← {p.tr('ui.back')}</Link></p>
      <h1>{p.tr('transport.live')}</h1>
      <p className="muted">{p.tr('transport.family.refresh')}</p>
      {!p.flag('saferoute') ? <p role="status" className="notice">{p.tr('transport.off')}</p> : null}
      {trips.length === 0 ? <p className="muted">{p.tr('transport.noLive')}</p> : null}
      {trips.map((tr) => (
        <section key={tr.trip_id} className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>{tr.route_name} <span className="muted ltr">{tr.vehicle_label}</span> · {p.tr(`transport.dir.${tr.direction}`)}</h2>
          <p className="muted">{p.tr('transport.onBoard', { n: tr.on_board, total: tr.riders })} · {tr.position_at ? p.tr('transport.updated', { time: ageText(tr.position_at, p.locale) }) : p.tr('transport.noFix')}</p>
          {tr.lat != null && tr.lng != null ? <BusMap lat={tr.lat} lng={tr.lng} label={tr.route_name} height={360} /> : null}
        </section>
      ))}
    </>
  );
}
