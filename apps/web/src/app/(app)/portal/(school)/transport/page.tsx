import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { t } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { LiveBuses } from '@/components/live-buses';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Transport', robots: { index: false, follow: false } };
const here = '/portal/transport';
const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (String(v ?? '').trim() || null);

// Plain table writes: RLS (transport.manage) is the gate and every change is audited by the standard triggers.
async function addRoute(form: FormData) {
  'use server';
  const r = z.object({ name: z.string().min(1).max(80), vehicle: z.string().max(30).nullable(), driver: uuid.nullable(), attendant: uuid.nullable() })
    .safeParse({ name: opt(form.get('name')), vehicle: opt(form.get('vehicle')), driver: opt(form.get('driver')), attendant: opt(form.get('attendant')) });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('transport_routes').insert({ tenant_id: me.tenant.id, name: r.data.name, vehicle_label: r.data.vehicle, driver_staff_id: r.data.driver, attendant_staff_id: r.data.attendant });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'transport.saved'));
}

async function updateRoute(form: FormData) {
  'use server';
  const r = z.object({ id: uuid, vehicle: z.string().max(30).nullable(), driver: uuid.nullable(), attendant: uuid.nullable(), arrival: z.string().regex(/^d{2}:d{2}$/).nullable(), grace: z.coerce.number().int().min(0).max(180) })
    .safeParse({ id: form.get('id'), vehicle: opt(form.get('vehicle')), driver: opt(form.get('driver')), attendant: opt(form.get('attendant')), arrival: opt(form.get('arrival')), grace: form.get('grace') || 25 });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.from('transport_routes').update({ vehicle_label: r.data.vehicle, driver_staff_id: r.data.driver, attendant_staff_id: r.data.attendant, expected_arrival: r.data.arrival, grace_minutes: r.data.grace }).eq('id', r.data.id);
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'transport.saved'));
}

async function addRider(form: FormData) {
  'use server';
  const r = z.object({ route: uuid, student: uuid, stop: z.string().max(80).nullable() }).safeParse({ route: form.get('route'), student: form.get('student'), stop: opt(form.get('stop')) });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  // a child moves route by re-adding: one route per child (primary key), so replace any earlier row
  const { error } = await sb.from('transport_riders').upsert({ tenant_id: me.tenant.id, student_id: r.data.student, route_id: r.data.route, stop_name: r.data.stop }, { onConflict: 'tenant_id,student_id' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'transport.saved'));
}

async function removeRider(form: FormData) {
  'use server';
  const r = uuid.safeParse(form.get('student'));
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.from('transport_riders').delete().eq('student_id', r.data);
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'transport.saved'));
}

export default async function Transport({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'transport.manage', 'tracking.live.view');
  const sp = await searchParams;
  const manage = p.can('transport.manage');
  const [{ data: routes }, { data: riders }, { data: staff }, { data: students }, live] = await Promise.all([
    p.sb.from('transport_routes').select('id, name, vehicle_label, driver_staff_id, attendant_staff_id, is_active, expected_arrival, grace_minutes').order('name'),
    manage ? p.sb.from('transport_riders').select('student_id, route_id, stop_name') : Promise.resolve({ data: [] }),
    manage ? p.sb.from('staff_members').select('id, full_name, user_id, status').eq('status', 'active').order('full_name') : Promise.resolve({ data: [] }),
    manage ? p.sb.from('students').select('id, full_name, admission_no').eq('status', 'enrolled').order('full_name') : Promise.resolve({ data: [] }),
    p.can('tracking.live.view') && p.flag('saferoute') ? p.sb.rpc('live_trips') : Promise.resolve({ data: [] }),
  ]);
  const name = new Map((students ?? []).map((s) => [s.id as string, s.full_name as string]));
  const staffName = new Map((staff ?? []).map((s) => [s.id as string, s.full_name as string]));
  type Live = { trip_id: string; route_name: string; vehicle_label: string | null; direction: string; lat: number | null; lng: number | null; position_at: string | null; riders: number; on_board: number };
  const trips = (live.data ?? []) as Live[];
  const staffSelect = (field: string, value?: string | null) => (
    <select name={field} defaultValue={value ?? ''}>
      <option value="">{p.tr('transport.none')}</option>
      {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.user_id ? '' : ' *'}</option>)}
    </select>
  );

  return (
    <>
      <h1>{p.tr('transport.title')}</h1>
      <Flash sp={sp} />
      {!p.flag('saferoute') ? <p role="status" className="notice">{p.tr('transport.off')}</p> : null}
      <p className="muted">{p.tr('transport.how')}</p>

      {p.can('tracking.live.view') ? <LiveBuses p={p} open /> : null}

      <h2>{p.tr('transport.routes')}</h2>
      {(routes ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : null}
      {(routes ?? []).map((r) => {
        const mine = (riders ?? []).filter((x) => x.route_id === r.id);
        return (
          <section key={r.id} className="card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>{r.name} <span className="muted ltr">{r.vehicle_label}</span></h3>
            {manage ? (
              <>
                <form action={updateRoute} className="inline">
                  <input type="hidden" name="id" value={r.id} />
                  <label>{p.tr('transport.vehicle')} <input name="vehicle" defaultValue={r.vehicle_label ?? ''} maxLength={30} /></label>
                  <label>{p.tr('transport.driver')} {staffSelect('driver', r.driver_staff_id)}</label>
                  <label>{p.tr('transport.attendant')} {staffSelect('attendant', r.attendant_staff_id)}</label>
                  <label>{p.l('Expected at school', 'اسکول پہنچنے کا وقت')} <input type="time" name="arrival" defaultValue={r.expected_arrival?.slice(0, 5) ?? ''} className="ltr" /></label>
                  <label>{p.l('Grace (min)', 'مہلت (منٹ)')} <input type="number" name="grace" min={0} max={180} defaultValue={r.grace_minutes ?? 25} className="ltr" style={{ width: '5rem' }} /></label>
                  <button className="btn secondary">{p.tr('transport.save')}</button>
                </form>
                <h4>{p.tr('transport.riders')} ({mine.length})</h4>
                {mine.length ? (
                  <div className="table-scroll"><table className="grid">
                    <thead><tr><th>{p.tr('ui.name')}</th><th>{p.tr('transport.stop')}</th><th /></tr></thead>
                    <tbody>{mine.map((x) => (
                      <tr key={x.student_id}><td>{name.get(x.student_id) ?? '—'}</td><td>{x.stop_name ?? ''}</td>
                        <td><form action={removeRider}><input type="hidden" name="student" value={x.student_id} /><button className="link">{p.tr('transport.remove')}</button></form></td></tr>
                    ))}</tbody>
                  </table></div>
                ) : null}
                <form action={addRider} className="inline">
                  <input type="hidden" name="route" value={r.id} />
                  <select name="student" required defaultValue="">
                    <option value="" disabled>{p.tr('transport.addRider')}</option>
                    {(students ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.admission_no})</option>)}
                  </select>
                  <input name="stop" placeholder={p.tr('transport.stop')} maxLength={80} />
                  <button className="btn secondary">{p.tr('transport.addRider')}</button>
                </form>
                <p><Link href={`/portal/transport/cards/${r.id}`}>{p.tr('transport.cards')}</Link></p>
              </>
            ) : (
              <p className="muted">{p.tr('transport.driver')}: {staffName.get(r.driver_staff_id ?? '') ?? '—'}</p>
            )}
          </section>
        );
      })}

      {manage ? (
        <section className="card">
          <h2>{p.tr('transport.addRoute')}</h2>
          <form action={addRoute} className="stack">
            <label>{p.tr('transport.routeName')} <input name="name" required maxLength={80} /></label>
            <label>{p.tr('transport.vehicle')} <input name="vehicle" maxLength={30} /></label>
            <label>{p.tr('transport.driver')} {staffSelect('driver')}</label>
            <label>{p.tr('transport.attendant')} {staffSelect('attendant')}</label>
            <p className="muted">* {p.tr('transport.driverHint')}</p>
            <button className="btn">{p.tr('transport.addRoute')}</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
