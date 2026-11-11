import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Students', robots: { index: false, follow: false } };
const here = '/portal/students';

const enrolSchema = z.object({
  name: z.string().trim().min(2).max(120), campus: z.string().uuid(), session: z.string().uuid(), class: z.string().uuid(),
  section: z.string().uuid().optional(), dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), gender: z.enum(['female', 'male', 'other']).optional(),
  guardian: z.string().trim().min(2).max(120), phone: z.string().trim().regex(/^[0-9+\-\s]{7,16}$/, 'phone number looks wrong'),
});

async function enrol(form: FormData) {
  'use server';
  const v = (k: string) => (String(form.get(k) ?? '').trim() || undefined);
  const r = enrolSchema.safeParse({ name: v('name'), campus: v('campus'), session: v('session'), class: v('class'), section: v('section'), dob: v('dob'), gender: v('gender'), guardian: v('guardian'), phone: v('phone') });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const i = r.data;
  const sb = await supabaseServer();
  // enrol_student links a sibling to the existing family when the guardian's phone is already on file.
  const { error } = await sb.rpc('enrol_student', { p_full_name: i.name, p_campus: i.campus, p_session: i.session, p_class: i.class, p_section: i.section ?? null, p_dob: i.dob ?? null, p_gender: i.gender ?? null, p_guardian_name: i.guardian, p_guardian_phone: i.phone, p_family: null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'students.enrolled'));
}

export default async function Students({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  const p = await portal();
  need(p, 'students.view');
  const sp = await searchParams;

  const [{ data: classes }, { data: sections }, { data: campuses }, { data: session }] = await Promise.all([
    p.sb.from('classes').select('id, name, level').order('level'),
    p.sb.from('sections').select('id, class_id, name').order('name'),
    p.sb.from('campuses').select('id, name').eq('is_active', true),
    p.sb.from('academic_sessions').select('id, name').eq('is_current', true).maybeSingle(),
  ]);
  const needle = (sp.q ?? '').replace(/[%,()]/g, '').trim();
  let sq = p.sb.from('students').select('id, admission_no, full_name, family_id').order('admission_no').limit(200);
  if (needle) sq = sq.ilike('full_name', `%${needle}%`);
  const { data: students } = await sq;
  const ids = (students ?? []).map((s) => s.id);
  const { data: enrol_ } = ids.length ? await p.sb.from('student_enrolments').select('student_id, class_id, section_id').eq('status', 'active').in('student_id', ids) : { data: [] };
  const cls = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const sec = new Map((sections ?? []).map((s) => [s.id, s.name]));
  const where = new Map((enrol_ ?? []).map((e) => [e.student_id, `${cls.get(e.class_id) ?? ''}${e.section_id ? ' · ' + (sec.get(e.section_id) ?? '') : ''}`]));
  const canCreate = p.can('students.create');

  return (
    <>
      <h1>{p.tr('students.title')}</h1>
      <Flash sp={sp} />
      {p.can('data.import') && p.can('students.create') ? <p><Link className="btn secondary small" href="/portal/students/import">{p.tr('import.open')}</Link></p> : null}
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder={p.tr('ui.name')} aria-label={p.tr('common.search')} />
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>
      {(students ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>{p.tr('students.admissionNo')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('students.class')}</th></tr></thead>
            <tbody>{(students ?? []).map((s) => <tr key={s.id}><td className="ltr">{s.admission_no}</td><td>{s.full_name}</td><td>{where.get(s.id) ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {canCreate && session ? (
        <>
          <h2>{p.tr('students.enrol')}</h2>
          <form action={enrol} className="form card">
            <label>{p.tr('students.fullName')}<input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
            <label>{p.tr('students.dob')}<input name="dob" type="date" className="ltr" /></label>
            <label>{p.tr('students.gender')}
              <select name="gender"><option value="">—</option><option value="female">{p.tr('students.female')}</option><option value="male">{p.tr('students.male')}</option><option value="other">{p.tr('students.other')}</option></select>
            </label>
            <input type="hidden" name="session" value={session.id} />
            {(campuses ?? []).length === 1 ? <input type="hidden" name="campus" value={campuses![0]!.id} />
              : <label>{p.tr('ui.campus')}<select name="campus" required>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            <label>{p.tr('students.class')}<select name="class" required>{(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>{p.tr('students.section')}
              <select name="section"><option value="">—</option>{(sections ?? []).map((s) => <option key={s.id} value={s.id}>{cls.get(s.class_id)} · {s.name}</option>)}</select>
            </label>
            <label>{p.tr('students.guardianName')}<input name="guardian" required minLength={2} maxLength={120} autoComplete="off" /></label>
            <label>{p.tr('students.guardianPhone')}<input name="phone" required inputMode="tel" className="ltr" autoComplete="off" /></label>
            <p className="muted">{p.tr('students.siblingsNote')}</p>
            <button className="btn">{p.tr('students.enrol')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
