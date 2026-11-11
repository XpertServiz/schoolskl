import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Exam', robots: { index: false, follow: false } };

async function addAssessment(form: FormData) {
  'use server';
  const r = z.object({ exam: z.string().uuid(), class: z.string().uuid(), subject: z.string().uuid(), max: z.coerce.number().positive().max(10000) })
    .safeParse({ exam: form.get('exam'), class: form.get('class'), subject: form.get('subject'), max: form.get('max') });
  const back = `/portal/exams/${String(form.get('exam'))}`;
  if (!r.success) return fail(back, { message: r.error.issues[0]?.message ?? 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('define_assessment', { p_exam: r.data.exam, p_class: r.data.class, p_subject: r.data.subject, p_max: r.data.max });
  if (error) return fail(back, error);
  revalidatePath(back);
  done(back, t(await getLocale(), 'ui.ok'));
}

export default async function Exam({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const p = await portal();
  need(p, 'exams.marks.moderate', 'exams.marks.enter', 'results.publish');
  const sp = await searchParams;
  const { data: exam } = await p.sb.from('exams').select('id, name, status').eq('id', id).maybeSingle();
  if (!exam) notFound();
  const [{ data: progress }, { data: classes }, { data: subjects }, { data: assessments }] = await Promise.all([
    p.sb.rpc('marks_progress', { p_exam: id }),
    p.sb.from('classes').select('id, name'),
    p.sb.from('subjects').select('id, name').eq('is_active', true).order('name'),
    p.sb.from('assessments').select('id, max_marks').eq('exam_id', id),
  ]);
  const cls = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const sub = new Map((subjects ?? []).map((s) => [s.id as string, s.name as string]));
  const max = new Map((assessments ?? []).map((a) => [a.id as string, Number(a.max_marks)]));
  const rows = (progress ?? []) as { assessment_id: string; class_id: string; subject_id: string; expected: number; entered: number }[];
  const canDefine = p.can('exams.marks.moderate') && exam.status === 'draft';

  return (
    <>
      <p><Link href="/portal/exams">← {p.tr('ui.back')}</Link></p>
      <h1>{exam.name} <span className="pill">{p.tr(`exams.stage.${exam.status}`)}</span></h1>
      <Flash sp={sp} />
      {rows.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('students.class')}</th><th>{p.tr('exams.subject')}</th><th className="num">{p.tr('exams.maxMarks')}</th><th className="num">{p.tr('exams.entered')}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.assessment_id}>
              <td>{cls.get(r.class_id)}</td><td>{sub.get(r.subject_id)}</td><td className="num">{max.get(r.assessment_id)}</td>
              <td className="num">{r.entered}/{r.expected}</td>
              <td>{exam.status === 'marking' || exam.status === 'moderation' ? <Link href={`/portal/exams/${id}/marks/${r.assessment_id}`}>{p.tr('exams.enterMarks')}</Link> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {canDefine ? (
        <form action={addAssessment} className="form card" style={{ marginTop: '2rem' }}>
          <input type="hidden" name="exam" value={id} />
          <label>{p.tr('students.class')}<select name="class" required>{(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{p.tr('exams.subject')}<select name="subject" required>{(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{p.tr('exams.maxMarks')}<input name="max" type="number" min="1" step="0.5" required className="ltr" /></label>
          <button className="btn">{p.tr('common.save')}</button>
        </form>
      ) : null}
    </>
  );
}
