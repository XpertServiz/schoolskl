import Link from 'next/link';
import { Flash } from '@/components/flash';
import type { BusStatus } from '@/lib/bus';
import { portal } from '@/lib/portal';
import { BusSection } from '../bus-section';

export const metadata = { title: 'School bus', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** The parent's live bus page: refreshes every 20 s with no client JS. Shows only what my_bus_status allows (own children, own consent). */
export default async function FamilyBus({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  const { data } = await p.sb.rpc('my_bus_status');
  const rows = (data ?? []) as BusStatus[];
  return (
    <>
      {rows.some((b) => b.trip_id) ? <meta httpEquiv="refresh" content="20" /> : null}
      <p className="inline"><Link href="/portal/family">← {p.tr('ui.back')}</Link></p>
      <h1>{p.tr('transport.family.bus')}</h1>
      <Flash sp={sp} />
      <p className="muted">{p.tr('transport.family.refresh')}</p>
      {rows.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : null}
      {rows.map((b) => (
        <section key={b.student_id} className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>{b.first_name}</h2>
          <BusSection p={p} b={b} back="/portal/family/bus" big />
        </section>
      ))}
    </>
  );
}
