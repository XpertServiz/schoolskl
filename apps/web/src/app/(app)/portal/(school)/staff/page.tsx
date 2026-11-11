import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Staff', robots: { index: false, follow: false } };
const here = '/portal/staff';
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const STAFF_STATUSES = ['active', 'on_leave', 'resigned', 'terminated'] as const;
const ATT_STATUSES = ['present', 'absent', 'late', 'half_day', 'leave'] as const;

// Plain table writes for the staff register: RLS (payroll.prepare) is the gate and every change is audited by the standard triggers.
async function addStaff(form: FormData) {
  'use server';
  const v = (k: string) => (String(form.get(k) ?? '').trim() || undefined);
  const r = z.object({
    no: z.string().min(1).max(20), name: z.string().min(2).max(120), designation: z.string().max(80).optional(),
    start: time, end: time, joined: date.optional(), login: uuid.optional(), campus: uuid.optional(),
  }).safeParse({ no: v('no'), name: v('name'), designation: v('designation'), start: v('start'), end: v('end'), joined: v('joined'), login: v('login'), campus: v('campus') });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('staff_members').insert({
    tenant_id: me.tenant.id, employee_no: r.data.no, full_name: r.data.name, designation: r.data.designation ?? null,
    shift_start: r.data.start, shift_end: r.data.end, joined_on: r.data.joined ?? null, user_id: r.data.login ?? null, campus_id: r.data.campus ?? null,
  });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'staff.added'));
}

async function setStatus(form: FormData) {
  'use server';
  const r = z.object({ id: uuid, status: z.enum(STAFF_STATUSES) }).safeParse({ id: form.get('id'), status: form.get('status') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const leaving = r.data.status === 'resigned' || r.data.status === 'terminated';
  const { error } = await sb.from('staff_members')
    .update({ status: r.data.status, left_on: leaving ? new Date().toISOString().slice(0, 10) : null })
    .eq('id', r.data.id);
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

/** HR marks the whole day at once; the RPC refuses future dates and staff from another school, and re-marking overwrites. */
async function saveAttendance(form: FormData) {
  'use server';
  const day = date.safeParse(form.get('date'));
  if (!day.success) return fail(here, { message: 'invalid date' });
  const back = `${here}?date=${day.data}`;
  const entries: { staff_id: string; status: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('a_') || typeof v !== 'string') continue;
    const id = uuid.safeParse(k.slice(2));
    const st = z.enum(ATT_STATUSES).safeParse(v);
    if (id.success && st.success) entries.push({ staff_id: id.data, status: st.data });
  }
  const sb = await supabaseServer();
  const { error } = await sb.rpc('mark_staff_attendance', { p_date: day.data, p_entries: entries });
  if (error) return fail(back, error);
  revalidatePath(here);
  done(back, t(await getLocale(), 'staff.att.saved'));
}

async function checkIn() {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('staff_check_in');
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'staff.me.done'));
}

async function checkOut() {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('staff_check_out');
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'staff.me.done'));
}

const hhmm = (x: unknown) => (typeof x === 'string' ? x.slice(0, 5) : '');

async function addDevice(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('register_attendance_device', { p_name: String(form.get('name') ?? '') });
  if (error) return fail(here, error);
  revalidatePath(here);
  // the key is shown once, in the message, and never stored in readable form
  done(here, 'Device key (copy it now, it is not shown again): ' + data);
}
async function toggleDevice(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_attendance_device_active', { p_id: String(form.get('id')), p_active: form.get('on') === '1' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, 'OK');
}

export default async function Staff({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; date?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  const manager = p.can('staff.manage');
  const viewer = manager || p.can('attendance.view') || p.can('timetable.manage');
  const { data: mine } = await p.sb.from('staff_members').select('id, full_name, status').eq('user_id', p.user.id).maybeSingle();
  if (!viewer && !mine) need(p, 'staff.manage'); // bounces with "no access"

  const today = new Date().toISOString().slice(0, 10);
  const day = date.safeParse(sp.date).success ? sp.date! : today;

  const [{ data: myToday }, { data: staff }, { data: marks }, { data: campuses }, { data: members }] = await Promise.all([
    mine ? p.sb.from('staff_attendance').select('status, check_in, check_out').eq('staff_id', mine.id).eq('att_date', today).maybeSingle() : Promise.resolve({ data: null }),
    viewer ? p.sb.from('staff_members').select('id, employee_no, full_name, designation, status, shift_start, shift_end, user_id').order('employee_no') : Promise.resolve({ data: [] }),
    manager ? p.sb.from('staff_attendance').select('staff_id, status').eq('att_date', day) : Promise.resolve({ data: [] }),
    manager ? p.sb.from('campuses').select('id, name').eq('is_active', true) : Promise.resolve({ data: [] }),
    manager ? p.sb.from('user_tenants').select('user_id').eq('status', 'active') : Promise.resolve({ data: [] }),
  ]);
  // Logins that are not already linked to a staff record. Names come from profiles, which only member managers can read; others see none.
  const linked = new Set((staff ?? []).map((s) => s.user_id).filter(Boolean));
  const freeIds = (members ?? []).map((m) => m.user_id as string).filter((id) => !linked.has(id));
  const { data: profiles } = freeIds.length ? await p.sb.from('profiles').select('user_id, full_name').in('user_id', freeIds) : { data: [] };
  const { data: devices } = manager ? await p.sb.from('attendance_devices').select('id, name, is_active, last_seen').order('created_at') : { data: [] };
  const att = new Map((marks ?? []).map((m) => [m.staff_id as string, m.status as string]));
  const active = (staff ?? []).filter((s) => s.status === 'active' || s.status === 'on_leave');

  return (
    <>
      <h1>{p.tr('staff.title')}</h1>
      <Flash sp={sp} />

      {mine ? (
        <section className="card">
          <h2>{p.tr('staff.me.title')}</h2>
          <p>{myToday?.check_in ? p.tr('staff.me.in', { time: hhmm(myToday.check_in) }) : p.tr('staff.me.none')}
            {myToday?.check_out ? <> · {p.tr('staff.me.out', { time: hhmm(myToday.check_out) })}</> : null}
            {myToday?.status ? <> · <span className="pill">{p.tr(`staff.att.statuses.${myToday.status}`)}</span></> : null}</p>
          <div className="inline">
            {!myToday?.check_in ? <form action={checkIn}><button className="btn">{p.tr('staff.me.checkIn')}</button></form> : null}
            {myToday?.check_in && !myToday?.check_out ? <form action={checkOut}><button className="btn secondary">{p.tr('staff.me.checkOut')}</button></form> : null}
          </div>
        </section>
      ) : null}

      {manager ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{p.l('Attendance machines (fingerprint / face / card)', 'حاضری مشینیں (فنگر پرنٹ / چہرہ / کارڈ)')}</h2>
          <p className="muted">{p.l('Register a machine to get a device key. The machine, or a small bridge program that reads its database, sends each punch as POST /api/attendance/punch {token, employee_no, at}. The employee number must match the one on the staff record. A punch is recorded as the employee’s own attendance and an earlier check-in is never changed.', 'مشین رجسٹر کر کے ڈیوائس کلید لیں۔ مشین، یا اس کا ڈیٹا بیس پڑھنے والا چھوٹا برج پروگرام، ہر پنچ POST /api/attendance/punch {token, employee_no, at} پر بھیجتا ہے۔ ملازم نمبر اسٹاف ریکارڈ کے مطابق ہو۔ پنچ ملازم کی اپنی حاضری کے طور پر درج ہوتا ہے اور پہلا چیک اِن کبھی تبدیل نہیں ہوتا۔')}</p>
          {(devices ?? []).map((d) => (
            <form key={d.id} action={toggleDevice} className="inline"><input type="hidden" name="id" value={d.id} /><strong>{d.name}</strong><span className="muted ltr">{d.last_seen ? String(d.last_seen).slice(0, 16).replace('T', ' ') : p.l('never seen', 'ابھی تک رابطہ نہیں')}</span><button name="on" value={d.is_active ? '0' : '1'} className="btn secondary small">{d.is_active ? p.l('Switch off', 'بند') : p.l('Switch on', 'چالو')}</button></form>
          ))}
          <form action={addDevice} className="inline" style={{ marginTop: '.75rem' }}><input name="name" required minLength={2} placeholder={p.l('Machine name, e.g. Front gate', 'مشین کا نام، مثلاً مین گیٹ')} /><button className="btn small">{p.l('Add machine', 'مشین شامل کریں')}</button></form>
        </section>
      ) : null}

      {viewer ? (
        <>
          <h2>{p.tr('staff.list')}</h2>
          {(staff ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>{p.tr('staff.employeeNo')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('staff.designation')}</th><th>{p.tr('staff.shift')}</th><th>{p.tr('ui.status')}</th></tr></thead>
              <tbody>{(staff ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="ltr">{s.employee_no}</td>
                  <td>{s.full_name}</td>
                  <td>{s.designation ?? '—'}</td>
                  <td className="ltr">{hhmm(s.shift_start)}–{hhmm(s.shift_end)}</td>
                  <td>
                    {manager ? (
                      <form action={setStatus} className="inline">
                        <input type="hidden" name="id" value={s.id} />
                        <select name="status" defaultValue={s.status} aria-label={p.tr('ui.status')}>
                          {STAFF_STATUSES.map((x) => <option key={x} value={x}>{p.tr(`staff.statuses.${x}`)}</option>)}
                        </select>
                        <button className="btn secondary small">{p.tr('staff.change')}</button>
                      </form>
                    ) : <span className="pill">{p.tr(`staff.statuses.${s.status}`)}</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      ) : null}

      {manager ? (
        <>
          <h2>{p.tr('staff.att.title')}</h2>
          <form className="inline" style={{ marginBottom: '0.75rem' }}>
            <input type="date" name="date" defaultValue={day} max={today} className="ltr" aria-label={p.tr('staff.att.date')} />
            <button className="btn secondary small">{p.tr('staff.att.show')}</button>
          </form>
          {active.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
            <form action={saveAttendance} className="card">
              <input type="hidden" name="date" value={day} />
              <div className="table-scroll"><table className="grid">
                <thead><tr><th>{p.tr('ui.name')}</th><th>{p.tr('ui.status')}</th></tr></thead>
                <tbody>{active.map((s) => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td>
                      <select name={`a_${s.id}`} defaultValue={att.get(s.id) ?? (s.status === 'on_leave' ? 'leave' : 'present')} aria-label={s.full_name}>
                        {ATT_STATUSES.map((x) => <option key={x} value={x}>{p.tr(`staff.att.statuses.${x}`)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
              <p><button className="btn">{p.tr('staff.att.save')}</button></p>
            </form>
          )}

          <h2>{p.tr('staff.add')}</h2>
          <form action={addStaff} className="form card">
            <label>{p.tr('staff.employeeNo')}<input name="no" required maxLength={20} className="ltr" /></label>
            <label>{p.tr('ui.name')}<input name="name" required minLength={2} maxLength={120} /></label>
            <label>{p.tr('staff.designation')}<input name="designation" maxLength={80} /></label>
            <label>{p.tr('staff.shiftStart')}<input name="start" type="time" defaultValue="08:00" required className="ltr" /></label>
            <label>{p.tr('staff.shiftEnd')}<input name="end" type="time" defaultValue="14:00" required className="ltr" /></label>
            <label>{p.tr('staff.joinedOn')}<input name="joined" type="date" className="ltr" /></label>
            {(campuses ?? []).length > 1 ? (
              <label>{p.tr('ui.campus')}<select name="campus"><option value="">—</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            ) : null}
            {(profiles ?? []).length > 0 ? (
              <label>{p.tr('staff.login')}
                <select name="login" defaultValue="">
                  <option value="">{p.tr('staff.noLogin')}</option>
                  {(profiles ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name ?? u.user_id.slice(0, 8)}</option>)}
                </select>
              </label>
            ) : null}
            <button className="btn">{p.tr('common.save')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
