import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Exams', robots: { index: false, follow: false } };
const here = '/portal/exams';
const NEXT: Record<string, string | undefined> = { draft: 'marking', marking: 'moderation' };

async function createExam(form: FormData) {
  'use server';
  const r = z.object({ session: z.string().uuid(), name: z.string().trim().min(2).max(80) }).safeParse({ session: form.get('session'), name: form.get('name') });
  if (!r.success) return fail(here, { message: r.error.issues[0]?.message ?? 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('create_exam', { p_session: r.data.session, p_name: r.data.name, p_starts: null, p_ends: null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function advance(form: FormData) {
  'use server';
  const r = z.object({ exam: z.string().uuid(), to: z.enum(['marking', 'moderation']) }).safeParse({ exam: form.get('exam'), to: form.get('to') });
  if (!r.success) return fail(here, { message: 'invalid stage change' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_exam_stage', { p_exam: r.data.exam, p_stage: r.data.to });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Exams({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'exams.marks.moderate', 'exams.marks.enter', 'results.publish');
  const sp = await searchParams;
  const [{ data: exams }, { data: session }] = await Promise.all([
    p.sb.from('exams').select('id, name, status, published_at').order('created_at', { ascending: false }),
    p.sb.from('academic_sessions').select('id').eq('is_current', true).maybeSingle(),
  ]);
  const coordinator = p.can('exams.marks.moderate');
  return (
    <>
      <h1>{p.tr('exams.title')}</h1>
      <Flash sp={sp} />
      {(exams ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('ui.name')}</th><th>{p.tr('ui.status')}</th><th>{p.tr('ui.actions')}</th></tr></thead>
          <tbody>{(exams ?? []).map((e) => {
            const next = NEXT[e.status];
            return (
              <tr key={e.id}>
                <td><Link href={`/portal/exams/${e.id}`}>{e.name}</Link></td>
                <td><span className="pill">{p.tr(`exams.stage.${e.status}`)}</span></td>
                <td>
                  {coordinator && next ? (
                    <form action={advance} className="inline">
                      <input type="hidden" name="exam" value={e.id} /><input type="hidden" name="to" value={next} />
                      <button className="btn secondary small">{p.tr('exams.advance', { stage: p.tr(`exams.stage.${next}`) })}</button>
                    </form>
                  ) : e.status === 'moderation' ? <Link href="/portal/approvals">{p.tr('approvals.title')}</Link> : null}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {coordinator && session ? (
        <form action={createExam} className="form card" style={{ marginTop: '2rem' }}>
          <input type="hidden" name="session" value={session.id} />
          <label>{p.tr('ui.name')}<input name="name" required minLength={2} maxLength={80} /></label>
          <button className="btn">{p.tr('common.save')}</button>
        </form>
      ) : null}
    </>
  );
}
