import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Admissions', robots: { index: false, follow: false } };
const here = '/portal/admissions';

// Mirrors the stage machine in advance_inquiry (the RPC is the authority; this only decides which buttons to draw).
// 'enrolled' is reached through enrol_from_inquiry, never by a stage button.
const MOVES: Record<string, string[]> = {
  inquiry: ['visit_scheduled', 'test_scheduled', 'offered', 'declined', 'lost'],
  visit_scheduled: ['test_scheduled', 'offered', 'declined', 'lost'],
  test_scheduled: ['offered', 'declined', 'lost'],
  offered: ['accepted', 'declined', 'lost'],
  accepted: ['lost'],
  declined: ['inquiry'],
  lost: ['inquiry'],
};

async function create(form: FormData) {
  'use server';
  const v = (k: string) => (String(form.get(k) ?? '').trim() || undefined);
  const r = z.object({ campus: z.string().uuid(), child: z.string().min(2).max(120), guardian: z.string().min(2).max(120), phone: z.string().regex(/^[0-9+\-\s]{7,16}$/), follow: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .safeParse({ campus: v('campus'), child: v('child'), guardian: v('guardian'), phone: v('phone'), follow: v('follow') });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('create_inquiry', { p_campus: r.data.campus, p_child_name: r.data.child, p_guardian_name: r.data.guardian, p_guardian_phone: r.data.phone, p_follow_up: r.data.follow ?? null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'admissions.created'));
}

async function move(form: FormData) {
  'use server';
  const r = z.object({ id: z.string().uuid(), to: z.string() }).safeParse({ id: form.get('id'), to: form.get('to') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('advance_inquiry', { p_id: r.data.id, p_stage: r.data.to, p_note: String(form.get('note') ?? '').trim() || null, p_follow_up: String(form.get('follow') ?? '') || null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Admissions({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  if (!p.has('admissions_crm')) return <p className="card">{p.tr('plan.notIncluded')}</p>;
  need(p, 'admissions.manage');
  const sp = await searchParams;
  const [{ data: inquiries }, { data: campuses }] = await Promise.all([
    p.sb.from('admission_inquiries').select('id, child_name, guardian_name, guardian_phone, stage, follow_up_on').order('created_at', { ascending: false }).limit(200),
    p.sb.from('campuses').select('id, name').eq('is_active', true),
  ]);
  return (
    <>
      <h1>{p.tr('admissions.title')}</h1>
      <Flash sp={sp} />
      {(inquiries ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('admissions.child')}</th><th>{p.tr('admissions.guardian')}</th><th>{p.tr('admissions.stage')}</th><th>{p.tr('admissions.followUp')}</th><th>{p.tr('admissions.move')}</th></tr></thead>
          <tbody>{(inquiries ?? []).map((i) => (
            <tr key={i.id}>
              <td>{i.child_name}</td>
              <td>{i.guardian_name}<br /><span className="ltr muted">{i.guardian_phone}</span></td>
              <td><span className="pill">{p.tr(`admissions.stages.${i.stage}`)}</span></td>
              <td className="ltr">{i.follow_up_on ?? '—'}</td>
              <td>
                <form action={move} className="inline">
                  <input type="hidden" name="id" value={i.id} />
                  {(MOVES[i.stage] ?? []).length ? (
                    <>
                      <select name="to" aria-label={p.tr('admissions.move')}>{(MOVES[i.stage] ?? []).map((s) => <option key={s} value={s}>{p.tr(`admissions.stages.${s}`)}</option>)}</select>
                      <input name="note" placeholder={p.tr('exams.reason')} />
                      <button className="btn secondary small">{p.tr('admissions.move')}</button>
                    </>
                  ) : null}
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>{p.tr('admissions.newInquiry')}</h2>
      <form action={create} className="form card">
        {(campuses ?? []).length === 1 ? <input type="hidden" name="campus" value={campuses![0]!.id} />
          : <label>{p.tr('ui.campus')}<select name="campus" required>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label>{p.tr('admissions.child')}<input name="child" required minLength={2} maxLength={120} /></label>
        <label>{p.tr('admissions.guardian')}<input name="guardian" required minLength={2} maxLength={120} /></label>
        <label>{p.tr('students.guardianPhone')}<input name="phone" required inputMode="tel" className="ltr" /></label>
        <label>{p.tr('admissions.followUp')}<input name="follow" type="date" className="ltr" /></label>
        <button className="btn">{p.tr('common.save')}</button>
      </form>
    </>
  );
}
