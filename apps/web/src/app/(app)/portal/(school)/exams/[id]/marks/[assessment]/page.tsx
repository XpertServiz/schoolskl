import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Marks', robots: { index: false, follow: false } };
const uuid = z.string().uuid();

/**
 * Teachers enter marks while the exam is in "marking" (class-scoped permission, checked by the RPC). In "moderation" teachers are locked
 * out and a coordinator changes a mark only with a written reason, which is stored in the amendment trail.
 */
async function enter(form: FormData) {
  'use server';
  const exam = uuid.parse(form.get('exam')), assessment = uuid.parse(form.get('assessment'));
  const back = `/portal/exams/${exam}/marks/${assessment}`;
  const max = Number(form.get('max'));
  const entries: { student_id: string; marks?: number; status?: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('m_') || typeof v !== 'string' || v.trim() === '') continue;
    const sid = uuid.safeParse(k.slice(2));
    if (!sid.success) continue;
    const s = v.trim().toLowerCase();
    if (s === 'a' || s === 'absent') entries.push({ student_id: sid.data, status: 'absent' });
    else if (s === 'e' || s === 'excused') entries.push({ student_id: sid.data, status: 'excused' });
    else {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > max) return fail(back, { message: `${v}: 0–${max}` });
      entries.push({ student_id: sid.data, marks: n });
    }
  }
  const sb = await supabaseServer();
  const { error } = await sb.rpc('enter_marks', { p_assessment: assessment, p_entries: entries });
  if (error) return fail(back, error);
  revalidatePath(back);
  done(back, t(await getLocale(), 'ui.ok'));
}

async function moderate(form: FormData) {
  'use server';
  const exam = uuid.parse(form.get('exam')), assessment = uuid.parse(form.get('assessment')), student = uuid.parse(form.get('student'));
  const back = `/portal/exams/${exam}/marks/${assessment}`;
  const raw = String(form.get('marks') ?? '').trim().toLowerCase();
  const status = raw === 'a' || raw === 'absent' ? 'absent' : raw === 'e' || raw === 'excused' ? 'excused' : 'present';
  const marks = status === 'present' ? Number(raw) : null;
  if (status === 'present' && (!Number.isFinite(marks) || raw === '')) return fail(back, { message: 'marks?' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('moderate_mark', { p_assessment: assessment, p_student: student, p_marks: marks, p_status: status, p_reason: String(form.get('reason') ?? '') });
  if (error) return fail(back, error);
  revalidatePath(back);
  done(back, t(await getLocale(), 'ui.ok'));
}

export default async function Marks({ params, searchParams }: { params: Promise<{ id: string; assessment: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id, assessment } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(assessment).success) notFound();
  const p = await portal();
  need(p, 'exams.marks.moderate', 'exams.marks.enter');
  const sp = await searchParams;
  const { data: a } = await p.sb.from('assessments').select('id, exam_id, class_id, subject_id, max_marks').eq('id', assessment).eq('exam_id', id).maybeSingle();
  if (!a) notFound();
  const [{ data: exam }, { data: enrolled }, { data: marks }, { data: subject }] = await Promise.all([
    p.sb.from('exams').select('name, status, session_id').eq('id', id).maybeSingle(),
    p.sb.from('student_enrolments').select('student_id, roll_no').eq('class_id', a.class_id).eq('status', 'active').order('roll_no'),
    p.sb.from('marks').select('student_id, marks, status').eq('assessment_id', assessment),
    p.sb.from('subjects').select('name').eq('id', a.subject_id).maybeSingle(),
  ]);
  if (!exam) notFound();
  const ids = (enrolled ?? []).map((e) => e.student_id as string);
  const { data: studs } = ids.length ? await p.sb.from('students').select('id, full_name').in('id', ids) : { data: [] };
  const name = new Map((studs ?? []).map((s) => [s.id as string, s.full_name as string]));
  const mk = new Map((marks ?? []).map((m) => [m.student_id as string, m.status === 'present' ? String(m.marks) : (m.status as string)]));
  const stage = exam.status as string;

  return (
    <>
      <p><Link href={`/portal/exams/${id}`}>← {p.tr('ui.back')}</Link></p>
      <h1>{exam.name} · {subject?.name}</h1>
      <p className="muted">{p.tr('exams.maxMarks')}: <span className="ltr">{Number(a.max_marks)}</span> · {p.tr('exams.entryHint')}</p>
      <Flash sp={sp} />
      {stage === 'marking' ? (
        <form action={enter} className="card">
          <input type="hidden" name="exam" value={id} /><input type="hidden" name="assessment" value={assessment} /><input type="hidden" name="max" value={Number(a.max_marks)} />
          <table className="grid"><tbody>{ids.map((sid) => (
            <tr key={sid}><td>{name.get(sid)}</td><td><input name={`m_${sid}`} defaultValue={mk.get(sid) ?? ''} className="ltr" size={6} inputMode="decimal" aria-label={name.get(sid)} /></td></tr>
          ))}</tbody></table>
          <p><button className="btn">{p.tr('common.save')}</button></p>
        </form>
      ) : stage === 'moderation' && p.can('exams.marks.moderate') ? (
        <table className="grid"><tbody>{ids.map((sid) => (
          <tr key={sid}><td>{name.get(sid)}</td><td className="ltr">{mk.get(sid) ?? '—'}</td>
            <td>
              <form action={moderate} className="inline">
                <input type="hidden" name="exam" value={id} /><input type="hidden" name="assessment" value={assessment} /><input type="hidden" name="student" value={sid} />
                <input name="marks" className="ltr" size={6} required aria-label={name.get(sid)} />
                <input name="reason" required placeholder={p.tr('exams.reason')} />
                <button className="btn secondary small">{p.tr('common.save')}</button>
              </form>
            </td></tr>
        ))}</tbody></table>
      ) : <p className="muted">{p.tr(`exams.stage.${stage}`)}</p>}
    </>
  );
}
