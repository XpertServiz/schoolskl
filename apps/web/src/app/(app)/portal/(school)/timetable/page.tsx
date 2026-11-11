import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Timetable', robots: { index: false, follow: false } };
const here = '/portal/timetable';
const uuid = z.string().uuid();
const time = z.string().regex(/^\d{2}:\d{2}$/);
const DAYS = [1, 2, 3, 4, 5, 6] as const; // Mon–Sat; DECISION: Sunday is off for every school until a tenant setting exists

// Plain table writes: RLS (timetable.manage) is the gate; the clash trigger refuses overlapping lessons for a section or a teacher.
async function addSubject(form: FormData) {
  'use server';
  const r = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/), name: z.string().trim().min(2).max(80) })
    .safeParse({ code: form.get('code'), name: form.get('name') });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('subjects').insert({ tenant_id: me.tenant.id, code: r.data.code, name: r.data.name });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function addPeriod(form: FormData) {
  'use server';
  const r = z.object({ campus: uuid, name: z.string().trim().min(1).max(40), starts: time, ends: time, order: z.coerce.number().int().min(0).max(99), brk: z.boolean() })
    .safeParse({ campus: form.get('campus'), name: form.get('name'), starts: form.get('starts'), ends: form.get('ends'), order: form.get('order') || 0, brk: form.get('brk') === 'on' });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('periods').insert({ tenant_id: me.tenant.id, campus_id: r.data.campus, name: r.data.name, starts_at: r.data.starts, ends_at: r.data.ends, sort_order: r.data.order, is_break: r.data.brk });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

/**
 * Set (or replace) the lesson in one cell. Not an upsert: the clash trigger runs BEFORE INSERT, i.e. before ON CONFLICT is considered,
 * so replacing a cell through upsert would clash with the very lesson it replaces. Update the existing cell instead.
 */
async function setLesson(form: FormData) {
  'use server';
  const r = z.object({ section: uuid, day: z.coerce.number().int().min(1).max(7), period: uuid, subject: uuid, teacher: uuid.optional() })
    .safeParse({ section: form.get('section'), day: form.get('day'), period: form.get('period'), subject: form.get('subject'), teacher: String(form.get('teacher') ?? '') || undefined });
  const back = `${here}?section=${String(form.get('section') ?? '')}`;
  if (!r.success) return fail(back, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: existing } = await sb.from('timetable_slots').select('id').eq('section_id', r.data.section).eq('day_of_week', r.data.day).eq('period_id', r.data.period).maybeSingle();
  const row = { subject_id: r.data.subject, teacher_id: r.data.teacher ?? null };
  let error;
  if (existing) ({ error } = await sb.from('timetable_slots').update(row).eq('id', existing.id));
  else {
    const { data: me } = await sb.rpc('my_access');
    ({ error } = await sb.from('timetable_slots').insert({ tenant_id: me.tenant.id, section_id: r.data.section, day_of_week: r.data.day, period_id: r.data.period, ...row }));
  }
  if (error) return fail(back, error);
  revalidatePath(here);
  done(back, t(await getLocale(), 'ui.ok'));
}

async function removeLesson(form: FormData) {
  'use server';
  const id = uuid.safeParse(form.get('id'));
  const back = `${here}?section=${String(form.get('section') ?? '')}`;
  if (!id.success) return fail(back, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.from('timetable_slots').delete().eq('id', id.data);
  if (error) return fail(back, error);
  revalidatePath(here);
  done(back, t(await getLocale(), 'ui.ok'));
}

const hhmm = (x: unknown) => (typeof x === 'string' ? x.slice(0, 5) : '');

export default async function Timetable({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; section?: string }> }) {
  const p = await portal();
  need(p, 'timetable.manage', 'attendance.mark', 'attendance.view');
  const sp = await searchParams;
  const manager = p.can('timetable.manage');

  const [{ data: subjects }, { data: periods }, { data: classes }, { data: sections }, { data: campuses }, { data: staff }] = await Promise.all([
    p.sb.from('subjects').select('id, code, name').eq('is_active', true).order('name'),
    p.sb.from('periods').select('id, campus_id, name, starts_at, ends_at, sort_order, is_break').order('sort_order').order('starts_at'),
    p.sb.from('classes').select('id, name, level, campus_id').order('level'),
    p.sb.from('sections').select('id, class_id, name').order('name'),
    p.sb.from('campuses').select('id, name').eq('is_active', true),
    p.sb.from('staff_members').select('id, full_name').eq('status', 'active').order('full_name'),
  ]);
  const cls = new Map((classes ?? []).map((c) => [c.id as string, c]));
  const subj = new Map((subjects ?? []).map((s) => [s.id as string, s]));
  const teacher = new Map((staff ?? []).map((s) => [s.id as string, s.full_name as string]));
  const campusName = new Map((campuses ?? []).map((c) => [c.id as string, c.name as string]));
  const section = (sections ?? []).find((s) => s.id === sp.section);
  const sectionCampus = section ? cls.get(section.class_id)?.campus_id : undefined;
  const bells = (periods ?? []).filter((x) => x.campus_id === sectionCampus);

  const { data: slots } = section
    ? await p.sb.from('timetable_slots').select('id, day_of_week, period_id, subject_id, teacher_id').eq('section_id', section.id)
    : { data: [] };
  const cell = new Map((slots ?? []).map((s) => [`${s.day_of_week}:${s.period_id}`, s]));

  return (
    <>
      <h1>{p.tr('timetable.title')}</h1>
      <Flash sp={sp} />

      <form className="inline" style={{ marginBottom: '1rem' }}>
        <select name="section" defaultValue={section?.id ?? ''} aria-label={p.tr('timetable.pickSection')} required>
          <option value="" disabled>{p.tr('timetable.pickSection')}</option>
          {(sections ?? []).map((s) => <option key={s.id} value={s.id}>{cls.get(s.class_id)?.name} · {s.name}</option>)}
        </select>
        <button className="btn secondary small">{p.tr('timetable.show')}</button>
      </form>

      {section ? (
        bells.length === 0 || (subjects ?? []).length === 0 ? <p className="notice">{p.tr('timetable.needSetup')}</p> : (
          <>
            <h2>{p.tr('timetable.grid')} — {cls.get(section.class_id)?.name} · {section.name}</h2>
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>{p.tr('timetable.period')}</th>{DAYS.map((d) => <th key={d}>{p.tr(`timetable.days.${d}`)}</th>)}</tr></thead>
              <tbody>{bells.map((b) => (
                <tr key={b.id}>
                  <th scope="row">{b.name}<br /><span className="muted ltr">{hhmm(b.starts_at)}–{hhmm(b.ends_at)}</span></th>
                  {DAYS.map((d) => {
                    if (b.is_break) return <td key={d} className="muted">{p.tr('timetable.breakCell')}</td>;
                    const s = cell.get(`${d}:${b.id}`);
                    return (
                      <td key={d}>
                        {s ? (
                          <>
                            <strong>{subj.get(s.subject_id)?.name ?? '—'}</strong>
                            {s.teacher_id ? <><br /><span className="muted">{teacher.get(s.teacher_id) ?? ''}</span></> : null}
                            {manager ? (
                              <form action={removeLesson}>
                                <input type="hidden" name="id" value={s.id} />
                                <input type="hidden" name="section" value={section.id} />
                                <button className="link small">{p.tr('timetable.remove')}</button>
                              </form>
                            ) : null}
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </table></div>

            {manager ? (
              <>
                <h2>{p.tr('timetable.setLesson')}</h2>
                <p className="muted">{p.tr('timetable.clashHint')}</p>
                <form action={setLesson} className="form card">
                  <input type="hidden" name="section" value={section.id} />
                  <label>{p.tr('timetable.day')}<select name="day" required>{DAYS.map((d) => <option key={d} value={d}>{p.tr(`timetable.days.${d}`)}</option>)}</select></label>
                  <label>{p.tr('timetable.period')}<select name="period" required>{bells.filter((b) => !b.is_break).map((b) => <option key={b.id} value={b.id}>{b.name} ({hhmm(b.starts_at)}–{hhmm(b.ends_at)})</option>)}</select></label>
                  <label>{p.tr('timetable.subject')}<select name="subject" required>{(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <label>{p.tr('timetable.teacher')}<select name="teacher" defaultValue=""><option value="">{p.tr('timetable.noTeacher')}</option>{(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
                  <button className="btn">{p.tr('common.save')}</button>
                </form>
              </>
            ) : null}
          </>
        )
      ) : null}

      {manager ? (
        <>
          <h2>{p.tr('timetable.subjects')}</h2>
          {(subjects ?? []).length ? <p>{(subjects ?? []).map((s) => <span key={s.id} className="pill" style={{ marginInlineEnd: '.4rem' }}>{s.code} · {s.name}</span>)}</p> : <p className="muted">{p.tr('ui.empty')}</p>}
          <form action={addSubject} className="inline card" style={{ marginBottom: '1rem' }}>
            <input name="code" required maxLength={12} placeholder={p.tr('timetable.code')} aria-label={p.tr('timetable.code')} className="ltr" />
            <input name="name" required minLength={2} maxLength={80} placeholder={p.tr('ui.name')} aria-label={p.tr('ui.name')} />
            <button className="btn small">{p.tr('timetable.addSubject')}</button>
          </form>

          <h2>{p.tr('timetable.periods')}</h2>
          {(periods ?? []).length ? (
            <div className="table-scroll"><table className="grid">
              <thead><tr><th>{p.tr('ui.campus')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('timetable.starts')}</th><th>{p.tr('timetable.ends')}</th><th>{p.tr('timetable.order')}</th></tr></thead>
              <tbody>{(periods ?? []).map((b) => (
                <tr key={b.id}><td>{campusName.get(b.campus_id) ?? '—'}</td><td>{b.name}{b.is_break ? <> <span className="pill">{p.tr('timetable.breakCell')}</span></> : null}</td><td className="ltr">{hhmm(b.starts_at)}</td><td className="ltr">{hhmm(b.ends_at)}</td><td className="num">{b.sort_order}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted">{p.tr('ui.empty')}</p>}
          <form action={addPeriod} className="form card">
            {(campuses ?? []).length === 1 ? <input type="hidden" name="campus" value={campuses![0]!.id} />
              : <label>{p.tr('ui.campus')}<select name="campus" required>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            <label>{p.tr('ui.name')}<input name="name" required maxLength={40} placeholder="1" /></label>
            <label>{p.tr('timetable.starts')}<input name="starts" type="time" required className="ltr" /></label>
            <label>{p.tr('timetable.ends')}<input name="ends" type="time" required className="ltr" /></label>
            <label>{p.tr('timetable.order')}<input name="order" type="number" min={0} max={99} defaultValue={(periods ?? []).length + 1} className="ltr" /></label>
            <label className="inline"><input name="brk" type="checkbox" /> {p.tr('timetable.isBreak')}</label>
            <button className="btn">{p.tr('timetable.addPeriod')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
