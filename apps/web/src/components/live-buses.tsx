import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { BusMap, ageText } from '@/components/bus-map';
import type { Portal } from '@/lib/portal';

type Live = { trip_id: string; route_name: string; vehicle_label: string | null; direction: string; lat: number | null; lng: number | null; position_at: string | null; riders: number; on_board: number };

/** Every bus on a trip right now; tap a bus to expand its map. Bus positions only (tracking.live.view) — never a child's. */
export async function LiveBuses({ p, open = false }: { p: Portal; open?: boolean }) {
  if (!p.flag('saferoute') || !p.can('tracking.live.view')) return null;
  const { data } = await p.sb.rpc('live_trips');
  const trips = (data ?? []) as Live[];
  return (
    <section className="card" aria-label={p.l('Buses on the road', 'سڑک پر بسیں')}>
      {trips.length ? <AutoRefresh seconds={60} /> : null}
      <h2 style={{ marginTop: 0 }}>🚌 {p.l('Buses on the road', 'سڑک پر بسیں')} <span className="muted">({trips.length})</span></h2>
      {trips.length === 0 ? <p className="muted">{p.tr('transport.noLive')}</p> : trips.map((tr) => (
        <details key={tr.trip_id} open={open} style={{ marginBottom: '.5rem' }}>
          <summary style={{ cursor: 'pointer' }}>
            <strong>{tr.route_name}</strong> <span className="muted ltr">{tr.vehicle_label}</span> · {p.tr(`transport.dir.${tr.direction}`)} · {p.tr('transport.onBoard', { n: tr.on_board, total: tr.riders })}
            {tr.position_at ? <span className="muted"> · {p.tr('transport.updated', { time: ageText(tr.position_at, p.locale) })}</span> : <span className="muted"> · {p.tr('transport.noFix')}</span>}
          </summary>
          {tr.lat != null && tr.lng != null ? <BusMap lat={tr.lat} lng={tr.lng} label={tr.route_name} height={320} /> : <p className="muted">{p.tr('transport.noFix')}</p>}
        </details>
      ))}
      <p><Link href="/portal/transport/live">{p.l('Full-screen map', 'مکمل نقشہ')}</Link></p>
    </section>
  );
}
