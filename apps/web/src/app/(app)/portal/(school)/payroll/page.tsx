import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';
import { rupeesToMinor } from '@/lib/money';

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

async function setPay(form: FormData) {
  'use server';
  const staff = z.string().uuid().parse(form.get('staff'));
  const basic = rupeesToMinor(String(form.get('basic') ?? ''));
  const leave = Number(form.get('leave'));
  if (basic == null || !Number.isInteger(leave) || leave < 0 || leave > 366) return fail(here, { message: 'Salary or leave days?' });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('staff_pay').upsert({ tenant_id: me.tenant.id, staff_id: staff, basic_minor: basic, annual_leave_days: leave }, { onConflict: 'staff_id' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

type Line = { staff_id: string; employee_no: string; full_name: string; designation: string | null; joined_on: string | null; basic_minor: number; annual_leave_days: number; present_days: number; late_days: number; half_days: number; leave_days: number; absent_days: number; leaves_taken_year: number; net_minor: number | null; status: string | null };

export default async function Payroll({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; m?: string }> }) {
  const p = await portal();
  need(p, 'payroll.prepare', 'payroll.post');
  const sp = await searchParams;
  const { data: runs } = await p.sb.from('payroll_runs').select('id, period, status, gross_minor, deductions_minor, net_minor').order('period', { ascending: false }).limit(36);
  const month = new Date().toISOString().slice(0, 7);
  const sm = sp.m && /^d{4}-d{2}$/.test(sp.m) ? sp.m : month;
  const { data: sheet } = await p.sb.rpc('payroll_sheet', { p_period: sm + '-01' });
  const lines = (sheet ?? []) as Line[];
  const editPay = p.can('payroll.prepare');
  return (
    <>
      <h1>{p.tr('payroll.title')}</h1>
      <Flash sp={sp} />
      <h2>{p.l('Employee-wise sheet', 'ملازمین کی شیٹ')} <span className="ltr muted">{sm}</span></h2>
      <form className="inline" style={{ marginBottom: '1rem' }}><input type="month" name="m" defaultValue={sm} max={month} className="ltr" /><button className="btn secondary small">{p.tr('common.search')}</button></form>
      {lines.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.l('Employee', 'ملازم')}</th><th>{p.l('Joined', 'شمولیت')}</th><th className="num">{p.l('Basic salary', 'بنیادی تنخواہ')}</th><th>{p.l('Present', 'حاضر')}</th><th>{p.l('Late', 'لیٹ')}</th><th>{p.l('Leave', 'رخصت')}</th><th>{p.l('Absent', 'غیر حاضر')}</th><th>{p.l('Annual leave used', 'سالانہ رخصت استعمال')}</th><th className="num">{p.l('Net', 'خالص')}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.staff_id}>
              <td>{l.full_name}<br /><span className="muted ltr">{l.employee_no} {l.designation ?? ''}</span></td>
              <td className="ltr">{l.joined_on ?? '—'}</td>
              <td className="num">{editPay ? (
                <form action={setPay} className="inline"><input type="hidden" name="staff" value={l.staff_id} /><input name="basic" defaultValue={l.basic_minor % 100 === 0 ? String(l.basic_minor / 100) : (l.basic_minor / 100).toFixed(2)} inputMode="decimal" className="ltr" size={8} aria-label={l.full_name} /><input name="leave" type="number" min={0} max={366} defaultValue={l.annual_leave_days} className="ltr" style={{ width: '4.5rem' }} title={p.l('Annual leave days allowed', 'سالانہ رخصت کے دن')} /><button className="btn secondary small">✓</button></form>
              ) : p.fmt(l.basic_minor)}</td>
              <td className="ltr">{l.present_days}</td><td className="ltr">{l.late_days}</td><td className="ltr">{l.leave_days}</td><td className="ltr">{l.absent_days}</td>
              <td className="ltr">{l.leaves_taken_year}/{l.annual_leave_days}</td>
              <td className="num">{l.net_minor != null ? p.fmt(l.net_minor) : '—'}{l.status ? <span className="pill">{l.status}</span> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted">{p.l('Absent days are deducted on a 30-day month; the basic salary and yearly leave allowance are set per employee here. Prepare the month below, then another person with payroll.post posts it from Approvals.', 'غیر حاضر دن 30 دن کے مہینے پر کٹتے ہیں؛ بنیادی تنخواہ اور سالانہ رخصت یہاں فی ملازم طے ہوتی ہے۔ نیچے مہینہ تیار کریں، پھر payroll.post والا دوسرا شخص منظوری سے پوسٹ کرے۔')}</p>
      <h2>{p.l('Payroll runs', 'پے رول رنز')}</h2>
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
