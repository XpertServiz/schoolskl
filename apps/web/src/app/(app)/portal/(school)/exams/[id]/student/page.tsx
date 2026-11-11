import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Marks per student', robots: { index: false, follow: false } };
const uuid = z.string().uuid();

/** One student, every subject on one screen. Each subject is still saved through enter_marks (class-scoped permission, "marking" stage only). */
async function save(form: FormData) {
  'use server';
  const exam = uuid.parse(form.get('exam')), student = uuid.parse(form.get('student'));
  const back = `/portal/exams/${exam}/student?s=${student}`;
  const sb = await supabaseServer();
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('m_') || typeof v !== 'string' || v.trim() === '') continue;
    const assessment = uuid.safeParse(k.slice(2));
    if (!assessment.success) continue;
    const max = Number(form.get(`x_${assessment.data}`));
    const s = v.trim().toLowerCase();
    const entry: { student_id: string; status?: string; marks?: number } = s === 'a' || s === 'absent' ? { student_id: student, status: 'absent' } : s === 'e' || s === 'excused' ? { student_id: student, status: 'excused' } : { student_id: student, marks: Number(s) };
    if ('marks' in entry && (entry.marks === undefined || !Number.isFinite(entry.marks) || entry.marks < 0 || entry.marks > max)) return fail(back, { message: `${v}: 0–${max}` });
    const { error } = await sb.rpc('enter_marks', { p_assessment: assessment.data, p_entries: [entry] });
    if (error) return fail(back, error);
  }
  revalidatePath(back);
  done(back, 'OK');
}

export default async function PerStudent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; s?: string; c?: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const p = await portal();
  need(p, 'exams.marks.enter', 'exams.marks.moderate');
  const sp = await searchParams;
  const [{ data: exam }, { data: asm }, { data: classes }, { data: subjects }] = await Promise.all([
    p.sb.from('exams').select('name, status').eq('id', id).maybeSingle(),
    p.sb.from('assessments').select('id, class_id, subject_id, max_marks').eq('exam_id', id),
    p.sb.from('classes').select('id, name').order('level'),
    p.sb.from('subjects').select('id, name'),
  ]);
  if (!exam) notFound();
  const examClasses = (classes ?? []).filter((c) => (asm ?? []).some((a) => a.class_id === c.id));
  const classId = examClasses.find((c) => c.id === sp.c)?.id ?? examClasses[0]?.id;
  const { data: enrolled } = classId ? await p.sb.from('student_enrolments').select('student_id, roll_no, students(full_name)').eq('class_id', classId).eq('status', 'active').order('roll_no') : { data: [] };
  const students = (enrolled ?? []).map((e) => ({ id: e.student_id as string, roll: e.roll_no as number | null, name: ((Array.isArray(e.students) ? e.students[0] : e.students) as { full_name?: string } | null)?.full_name ?? '—' }));
  const sel = students.find((s) => s.id === sp.s);
  const mine = (asm ?? []).filter((a) => a.class_id === classId);
  const { data: marks } = sel ? await p.sb.from('marks').select('assessment_id, marks, status').eq('student_id', sel.id).in('assessment_id', mine.map((a) => a.id)) : { data: [] };
  const mk = new Map((marks ?? []).map((m) => [m.assessment_id as string, m.status === 'present' ? String(m.marks) : (m.status as string)]));
  const sub = new Map((subjects ?? []).map((s) => [s.id as string, s.name as string]));
  const stage = exam.status as string;
  return (
    <>
      <p><Link href={`/portal/exams/${id}`}>← {p.tr('ui.back')}</Link></p>
      <h1>{exam.name} · {p.l('Marks per student', 'فی طالب علم نمبر')}</h1>
      <Flash sp={sp} />
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <select name="c" defaultValue={classId} aria-label={p.l('Class', 'کلاس')}>{examClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn secondary small">{p.l('Show students', 'طلبہ دکھائیں')}</button>
      </form>
      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {students.map((s) => <Link key={s.id} href={`/portal/exams/${id}/student?c=${classId}&s=${s.id}`} className={`btn ${sel?.id === s.id ? '' : 'secondary'} small`}>{s.roll ? s.roll + '. ' : ''}{s.name}</Link>)}
      </div>
      {sel ? (
        stage === 'marking' ? (
          <form action={save} className="card form">
            <h2 style={{ marginTop: 0 }}>{sel.name}</h2>
            <input type="hidden" name="exam" value={id} /><input type="hidden" name="student" value={sel.id} />
            {mine.map((a) => (
              <label key={a.id}>{sub.get(a.subject_id) ?? '—'} <span className="muted ltr">/ {Number(a.max_marks)}</span>
                <input name={`m_${a.id}`} defaultValue={mk.get(a.id) ?? ''} className="ltr" size={6} inputMode="decimal" />
                <input type="hidden" name={`x_${a.id}`} value={Number(a.max_marks)} />
              </label>
            ))}
            <p className="muted">{p.tr('exams.entryHint')}</p>
            <button className="btn">{p.tr('common.save')}</button>
          </form>
        ) : <p className="muted">{p.l('Marks can be entered only while the exam is in the “marking” stage. Use the subject pages for moderation.', 'نمبر صرف “مارکنگ” مرحلے میں درج ہو سکتے ہیں۔ ماڈریشن کے لیے مضمون کے صفحات استعمال کریں۔')}</p>
      ) : <p className="muted">{p.l('Pick a student.', 'طالب علم منتخب کریں۔')}</p>}
    </>
  );
}
