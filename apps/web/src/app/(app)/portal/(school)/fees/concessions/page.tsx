import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { rupeesToMinor } from '@/lib/money';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Concessions', robots: { index: false, follow: false } };
const here = '/portal/fees/concessions';

/** The requester can never approve their own request: the RPC refuses it (maker-checker). Approval happens in the Approvals Inbox. */
async function request(form: FormData) {
  'use server';
  const r = z.object({ student: z.string().uuid(), kind: z.enum(['percent', 'fixed']), value: z.string().min(1), reason: z.string().trim().min(3).max(300), head: z.string().uuid().optional() })
    .safeParse({ student: form.get('student'), kind: form.get('kind'), value: form.get('value'), reason: form.get('reason'), head: String(form.get('head') ?? '') || undefined });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  // percent is typed as 10 or 12.5 and stored as basis points; fixed is rupees stored as paisa
  let value: number | null;
  if (r.data.kind === 'percent') { const n = Number(r.data.value); value = Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) : null; }
  else value = rupeesToMinor(r.data.value);
  if (value == null || value <= 0) return fail(here, { message: `${r.data.value}: ?` });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('request_concession', { p_student: r.data.student, p_kind: r.data.kind, p_value: value, p_reason: r.data.reason, p_fee_head: r.data.head ?? null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'finance.concessions.requested'));
}

export default async function Concessions({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'fees.concession.request', 'fees.concession.approve', 'fees.view');
  const sp = await searchParams;
  const [{ data: list }, { data: students }, { data: heads }] = await Promise.all([
    p.sb.from('concessions').select('id, student_id, kind, value, reason, status, created_at').order('created_at', { ascending: false }).limit(100),
    p.sb.from('students').select('id, full_name, admission_no').order('full_name').limit(500),
    p.sb.from('fee_heads').select('id, name').eq('is_active', true).order('code'),
  ]);
  const name = new Map((students ?? []).map((s) => [s.id as string, s.full_name as string]));
  return (
    <>
      <h1>{p.tr('finance.concessions.title')}</h1>
      <Flash sp={sp} />
      {(list ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('fees.student')}</th><th>{p.tr('finance.concessions.value')}</th><th>{p.tr('finance.concessions.reason')}</th><th>{p.tr('ui.status')}</th></tr></thead>
          <tbody>{(list ?? []).map((c) => (
            <tr key={c.id}>
              <td>{name.get(c.student_id) ?? '—'}</td>
              <td className="ltr">{c.kind === 'percent' ? `${Number(c.value) / 100}%` : p.fmt(c.value)}</td>
              <td>{c.reason}</td>
              <td><span className="pill">{p.tr(`finance.concessions.status.${c.status}`)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {p.can('fees.concession.request') ? (
        <>
          <h2>{p.tr('finance.concessions.request')}</h2>
          <form action={request} className="form card">
            <label>{p.tr('fees.student')}<select name="student" required>{(students ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.admission_no})</option>)}</select></label>
            <label>{p.tr('finance.concessions.kind')}<select name="kind"><option value="percent">{p.tr('finance.concessions.percent')}</option><option value="fixed">{p.tr('finance.concessions.fixed')}</option></select></label>
            <label>{p.tr('finance.concessions.value')}<input name="value" required inputMode="decimal" className="ltr" /></label>
            <label>{p.tr('fees.title')}<select name="head"><option value="">{p.tr('finance.concessions.wholeVoucher')}</option>{(heads ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
            <label>{p.tr('finance.concessions.reason')}<input name="reason" required minLength={3} maxLength={300} /></label>
            <p className="muted">{p.tr('finance.concessions.note')}</p>
            <button className="btn">{p.tr('finance.concessions.request')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
