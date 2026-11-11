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

async function saveAddress(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_family_address', { p_family: z.string().uuid().parse(form.get('family')), p_address: String(form.get('address') ?? '').trim() });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

interface Row { student_id: string; admission_no: string; full_name: string; status: string; class_name: string | null; section_name: string | null; roll_no: number | null; family_id: string | null; guardian_name: string | null; guardian_phone: string | null; address: string | null }

/** wa.me/web.whatsapp.com wants digits only, with the country code (Pakistan: 03xx → 923xx). */
const waNumber = (raw: string) => { const d = raw.replace(/\D/g, ''); return d.startsWith('92') ? d : d.startsWith('0') ? '92' + d.slice(1) : d; };

export default async function Students({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string; c?: string }> }) {
  const p = await portal();
  need(p, 'students.view');
  const sp = await searchParams;

  const [{ data: classes }, { data: sections }, { data: campuses }, { data: session }, { data: dir }] = await Promise.all([
    p.sb.from('classes').select('id, name, level').order('level'),
    p.sb.from('sections').select('id, class_id, name').order('name'),
    p.sb.from('campuses').select('id, name').eq('is_active', true),
    p.sb.from('academic_sessions').select('id, name').eq('is_current', true).maybeSingle(),
    p.sb.rpc('students_directory'),
  ]);
  const needle = (sp.q ?? '').trim().toLowerCase();
  const all = (dir ?? []) as Row[];
  const rows = all.filter((s) => (!sp.c || s.class_name === sp.c) && (!needle || [s.full_name, s.admission_no, s.guardian_name ?? '', s.guardian_phone ?? ''].some((x) => x.toLowerCase().includes(needle)))).slice(0, 300);
  const canCreate = p.can('students.create');
  const canPhone = all.some((r) => r.guardian_phone);
  const canEditAddr = p.can('students.edit') || p.can('students.create');
  const cls = new Map((classes ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <h1>{p.tr('students.title')} <span className="muted" style={{ fontSize: '.6em' }}>{rows.length}/{all.length}</span></h1>
      <Flash sp={sp} />
      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {canCreate && session ? <a className="btn" href="#enrol">{p.tr('students.enrol')}</a> : null}
        {p.can('data.import') && p.can('students.create') ? <Link className="btn secondary small" href="/portal/students/import">{p.tr('import.open')}</Link> : null}
      </div>
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder={p.l('Name, roll no, parent, mobile', 'نام، رول نمبر، والدین، موبائل')} aria-label={p.tr('common.search')} />
        <select name="c" defaultValue={sp.c ?? ''} aria-label={p.tr('students.class')}><option value="">{p.l('All classes', 'تمام کلاسیں')}</option>{(classes ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>
      {rows.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll">
          <table className="grid">
            <thead><tr>
              <th>{p.tr('students.admissionNo')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('students.class')}</th><th>{p.l('Roll no', 'رول نمبر')}</th>
              <th>{p.l('Parent', 'والدین')}</th>{canPhone ? <th>{p.l('Mobile', 'موبائل')}</th> : null}<th>{p.l('Address', 'پتہ')}</th>
            </tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.student_id}>
                <td className="ltr">{s.admission_no}</td><td>{s.full_name}</td>
                <td>{s.class_name ?? '—'}{s.section_name ? ` · ${s.section_name}` : ''}</td>
                <td className="ltr">{s.roll_no ?? ''}</td>
                <td>{s.guardian_name ?? '—'}</td>
                {canPhone ? (
                  <td className="ltr">
                    {s.guardian_phone ?? ''}
                    {s.guardian_phone ? <> <a className="btn secondary small" target="_blank" rel="noopener noreferrer" href={`https://web.whatsapp.com/send?phone=${waNumber(s.guardian_phone)}`} title="WhatsApp">WhatsApp</a></> : null}
                  </td>
                ) : null}
                <td>
                  {canEditAddr && s.family_id ? (
                    <form action={saveAddress} className="inline"><input type="hidden" name="family" value={s.family_id} /><input name="address" defaultValue={s.address ?? ''} maxLength={250} aria-label={p.l('Address', 'پتہ')} /><button className="btn secondary small">✓</button></form>
                  ) : (s.address ?? '—')}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!canPhone && all.length ? <p className="muted">{p.l('Parent mobile numbers and WhatsApp are shown only to people the owner allows (permission “students · contact”).', 'والدین کے موبائل نمبر اور واٹس ایپ صرف انہیں نظر آتے ہیں جنہیں مالک اجازت دے (اجازت “students · contact”)۔')}</p> : null}

      {canCreate && session ? (
        <>
          <h2 id="enrol">{p.tr('students.enrol')}</h2>
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
