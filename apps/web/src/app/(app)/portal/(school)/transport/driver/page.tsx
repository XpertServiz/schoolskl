import { revalidatePath } from 'next/cache';
import { Flash } from '@/components/flash';
import { QrScan, TripGps } from '@/components/trip-tools';
import { act, str } from '@/lib/act';
import { portal } from '@/lib/portal';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Driver', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/portal/transport/driver';

async function start(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('start_trip', { p_route: str(form, 'route'), p_direction: str(form, 'direction') }));
}
async function end(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('end_trip', { p_trip: str(form, 'trip') }));
}
async function mark(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('mark_rider', { p_trip: str(form, 'trip'), p_student: str(form, 'student'), p_kind: str(form, 'kind') }));
}
/** Called from the browser while the trip is open. The RPC drops points outside the trip window. */
async function sendPoints(trip: string, points: { lat: number; lng: number; accuracy: number | null; at: string }[]) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('post_trip_positions', { p_trip: trip, p_points: points });
  if (error) throw new Error(error.message);
}
async function scan(trip: string, code: string): Promise<string> {
  'use server';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('scan_transport_card', { p_trip: trip, p_code: code });
  revalidatePath(here);
  if (error) return error.message;
  const r = data as { result?: string; first_name?: string } | null;
  return `${r?.first_name ?? ''} ${r?.result ?? ''}`.trim();
}

type MyRoute = { route_id: string; name: string; vehicle_label: string | null; riders: number; open_trip_id: string | null; open_direction: string | null };
type Rider = { student_id: string; first_name: string; stop_name: string | null; consent: boolean; state: string; state_at: string | null };
type Roster = { student_id: string; first_name: string; class_name: string | null; dismissal_time: string | null; stop_name: string | null; address: string | null };

export default async function Driver({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  if (!p.access.is_crew && !p.can('transport.manage')) redirect('/portal?err=' + encodeURIComponent(p.tr('ui.noAccess')));
  const sp = await searchParams;
  if (!p.flag('saferoute')) return <p role="status" className="notice">{p.tr('transport.off')}</p>;
  const { data } = await p.sb.rpc('my_transport_routes');
  const routes = (data ?? []) as MyRoute[];
  const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return (
    <>
      <h1>🚌 {p.l('My bus', 'میری بس')}</h1>
      <Flash sp={sp} />
      {routes.length === 0 ? <p className="muted">{p.l('No route is assigned to you.', 'آپ کے نام کوئی روٹ مقرر نہیں۔')}</p> : null}
      {await Promise.all(routes.map(async (r) => {
        const [roster, riders] = await Promise.all([
          p.sb.rpc('crew_roster', { p_route: r.route_id }),
          r.open_trip_id ? p.sb.rpc('trip_riders', { p_trip: r.open_trip_id }) : Promise.resolve({ data: [] }),
        ]);
        const list = (roster.data ?? []) as Roster[];
        const state = new Map(((riders.data ?? []) as Rider[]).map((x) => [x.student_id, x]));
        return (
          <section key={r.route_id} className="card" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ marginTop: 0 }}>{r.name} <span className="muted ltr">{r.vehicle_label}</span> · {r.riders} {p.l('students', 'طلبہ')}</h2>
            {r.open_trip_id ? (
              <>
                <TripGps tripId={r.open_trip_id} send={sendPoints} label={p.l('Sharing bus location', 'بس کی لوکیشن شیئر ہو رہی ہے')} />
                <QrScan tripId={r.open_trip_id} scan={scan} labels={{ start: p.l('Scan child card', 'بچے کا کارڈ اسکین کریں'), stop: p.l('Stop camera', 'کیمرہ بند'), manual: p.l('or type the card code', 'یا کارڈ کوڈ لکھیں'), send: p.l('Send', 'بھیجیں'), unsupported: p.l('This browser cannot scan; type the code or use the buttons below.', 'یہ براؤزر اسکین نہیں کر سکتا؛ کوڈ لکھیں یا نیچے بٹن استعمال کریں۔') }} />
                <form action={end} style={{ margin: '.75rem 0' }}><input type="hidden" name="trip" value={r.open_trip_id} /><button className="btn secondary">{p.l('End trip', 'سفر ختم کریں')}</button></form>
              </>
            ) : (
              <form action={start} className="inline" style={{ marginBottom: '.75rem' }}>
                <input type="hidden" name="route" value={r.route_id} />
                <button name="direction" value="to_school" className="btn">{p.l('Start trip to school', 'اسکول کا سفر شروع')}</button>
                <button name="direction" value="to_home" className="btn secondary">{p.l('Start trip home', 'گھر واپسی کا سفر شروع')}</button>
              </form>
            )}
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>{p.l('Student', 'طالب علم')}</th><th>{p.l('Class · ends', 'کلاس · چھٹی')}</th><th>{p.l('Stop / address', 'اسٹاپ / پتہ')}</th>{r.open_trip_id ? <th>{p.l('Now', 'حالت')}</th> : null}</tr></thead>
              <tbody>{list.map((s) => {
                const st = state.get(s.student_id);
                const place = [s.stop_name, s.address].filter(Boolean).join(' — ');
                return (
                  <tr key={s.student_id}>
                    <td>{s.first_name}</td>
                    <td>{s.class_name ?? ''} <span className="ltr muted">{s.dismissal_time?.slice(0, 5)}</span></td>
                    <td>{place ? <a href={maps(s.address || s.stop_name || '')} target="_blank" rel="noopener noreferrer">{place} ↗</a> : '—'}</td>
                    {r.open_trip_id ? (
                      <td>
                        <form action={mark} className="inline">
                          <input type="hidden" name="trip" value={r.open_trip_id} /><input type="hidden" name="student" value={s.student_id} />
                          <span className="pill">{st?.state ?? '—'}</span>
                          <button name="kind" value="boarded" className="btn secondary small">{p.l('On', 'سوار')}</button>
                          <button name="kind" value="alighted" className="btn secondary small">{p.l('Off', 'اتر گیا')}</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
        );
      }))}
    </>
  );
}
