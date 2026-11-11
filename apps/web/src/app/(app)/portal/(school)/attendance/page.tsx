import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Attendance', robots: { index: false, follow: false } };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

/**
 * The register defaults to everyone present; only exceptions are sent. The RPC checks the class-scoped permission, the day lock and the
 * "not in the future" rule, and queues the absence alert — this action adds nothing on top.
 */
async function save(form: FormData) {
  'use server';
  const section = uuid.parse(form.get('section'));
  const day = date.parse(form.get('date'));
  const back = `/portal/attendance?section=${section}&date=${day}`;
  const absent: string[] = [], late: string[] = [], leave: string[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('s_') || typeof v !== 'string') continue;
    const id = uuid.safeParse(k.slice(2));
    if (!id.success) continue;
    if (v === 'absent') absent.push(id.data); else if (v === 'late') late.push(id.data); else if (v === 'leave') leave.push(id.data);
  }
  const sb = await supabaseServer();
  const { error } = await sb.rpc('mark_attendance', { p_section: section, p_date: day, p_absent: absent, p_late: late, p_leave: leave });
  if (error) return fail(back, error);
  revalidatePath('/portal/attendance');
  done(back, t(await getLocale(), 'attendance.saved'));
}

export default async function Attendance({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; section?: string; date?: string }> }) {
  const p = await portal();
  need(p, 'attendance.mark', 'attendance.view');
  const sp = await searchParams;

  const [{ data: classes }, { data: sections }] = await Promise.all([
    p.sb.from('classes').select('id, name, level').order('level'),
    p.sb.from('sections').select('id, class_id, name').order('name'),
  ]);
  const cls = new Map((classes ?? []).map((c) => [c.id, c.name as string]));
  // DECISION: with no class chosen yet, open the first section so the register (with names) is on screen straight away
  const section = (sections ?? []).find((s) => s.id === sp.section) ?? (sections ?? [])[0];
  const day = date.safeParse(sp.date).success ? sp.date! : new Date().toISOString().slice(0, 10);

  let roster: { id: string; full_name: string; roll: number | null; status: string }[] = [];
  if (section) {
    const [{ data: enrolled }, { data: marks }] = await Promise.all([
      p.sb.from('student_enrolments').select('student_id, roll_no, students(id, full_name)').eq('section_id', section.id).eq('status', 'active').order('roll_no'),
      p.sb.from('student_attendance').select('student_id, status').eq('section_id', section.id).eq('att_date', day),
    ]);
    const st = new Map((marks ?? []).map((m) => [m.student_id as string, m.status as string]));
    roster = (enrolled ?? []).map((e) => {
      const stu = (Array.isArray(e.students) ? e.students[0] : e.students) as { full_name?: string } | null;
      return { id: e.student_id as string, full_name: stu?.full_name ?? '—', roll: e.roll_no as number | null, status: st.get(e.student_id as string) ?? 'present' };
    });
  }
  const canMark = p.can('attendance.mark');

  return (
    <>
      <h1>{p.tr('attendance.title')}</h1>
      <Flash sp={sp} />
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <select name="section" defaultValue={section?.id ?? ''} aria-label={p.tr('attendance.section')} required>
          <option value="" disabled>{p.tr('attendance.section')}</option>
          {(sections ?? []).map((s) => <option key={s.id} value={s.id}>{cls.get(s.class_id)} · {s.name}</option>)}
        </select>
        <input type="date" name="date" defaultValue={day} className="ltr" aria-label={p.tr('ui.date')} />
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>

      {section ? (
        <form action={save} className="card">
          <input type="hidden" name="section" value={section.id} />
          <input type="hidden" name="date" value={day} />
          <p className="muted">{p.tr('attendance.tickAbsent')}</p>
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>#</th><th>{p.tr('ui.name')}</th><th>{p.tr('ui.status')}</th></tr></thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.id}>
                    <td className="ltr">{r.roll ?? ""}</td>
                    <td>{r.full_name}</td>
                    <td>
                      <select name={`s_${r.id}`} defaultValue={r.status} disabled={!canMark} aria-label={r.full_name}>
                        <option value="present">{p.tr('cockpit.present')}</option>
                        <option value="absent">{p.tr('cockpit.absent')}</option>
                        <option value="late">{p.tr('attendance.late')}</option>
                        <option value="leave">{p.tr('attendance.leave')}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {roster.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : null}
          {canMark && roster.length > 0 ? <p><button className="btn">{p.tr('attendance.save')}</button></p> : null}
        </form>
      ) : null}
    </>
  );
}
