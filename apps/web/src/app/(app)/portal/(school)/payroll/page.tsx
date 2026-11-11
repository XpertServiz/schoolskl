import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Payroll', robots: { index: false, follow: false } };
const here = '/portal/payroll';

async function prepare(form: FormData) {
  'use server';
  const r = z.string().regex(/^\d{4}-\d{2}$/).safeParse(form.get('month'));
  if (!r.success) return fail(here, { message: 'month?' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('prepare_payroll', { p_period: `${r.data}-01` });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'payroll.prepared'));
}

// Posting is in the Approvals Inbox (a different person must do it). Payment is bank-only and needs payroll.post as well.
async function markPaid(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('mark_payroll_paid', { p_run: z.string().uuid().parse(form.get('run')) });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Payroll({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'payroll.prepare', 'payroll.post');
  const sp = await searchParams;
  const { data: runs } = await p.sb.from('payroll_runs').select('id, period, status, gross_minor, deductions_minor, net_minor').order('period', { ascending: false }).limit(36);
  const month = new Date().toISOString().slice(0, 7);
  return (
    <>
      <h1>{p.tr('payroll.title')}</h1>
      <Flash sp={sp} />
      {(runs ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('payroll.period')}</th><th>{p.tr('ui.status')}</th><th className="num">{p.tr('payroll.gross')}</th><th className="num">{p.tr('payroll.deductions')}</th><th className="num">{p.tr('payroll.net')}</th><th /></tr></thead>
          <tbody>{(runs ?? []).map((r) => (
            <tr key={r.id}>
              <td className="ltr">{String(r.period).slice(0, 7)}</td>
              <td><span className="pill">{p.tr(r.status === 'draft' ? 'payroll.draft' : `payroll.${r.status}`)}</span></td>
              <td className="num">{p.fmt(r.gross_minor)}</td><td className="num">{p.fmt(r.deductions_minor)}</td><td className="num">{p.fmt(r.net_minor)}</td>
              <td>
                {r.status === 'draft' ? <Link href="/portal/approvals">{p.tr('approvals.title')}</Link> : null}
                {r.status === 'posted' && p.can('payroll.post') ? (
                  <form action={markPaid}><input type="hidden" name="run" value={r.id} /><button className="btn secondary small">{p.tr('payroll.markPaid')}</button></form>
                ) : null}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {p.can('payroll.prepare') ? (
        <form action={prepare} className="form card" style={{ marginTop: '2rem' }}>
          <label>{p.tr('payroll.prepare')}<input type="month" name="month" defaultValue={month} max={month} required className="ltr" /></label>
          <button className="btn">{p.tr('payroll.prepare')}</button>
        </form>
      ) : null}
    </>
  );
}
