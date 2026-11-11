import { portal } from '@/lib/portal';

export const metadata = { title: 'My payslips', robots: { index: false, follow: false } };

interface Line { code: string; name: string; kind: string; amount: number }

/** A staff member sees only their own payslips, and only once the run is posted (RLS + the `published` flag). */
export default async function Payslips() {
  const p = await portal();
  const { data: mine } = await p.sb.from('staff_members').select('id').eq('user_id', p.user.id).maybeSingle();
  const { data: slips } = mine
    ? await p.sb.from('payslips').select('id, run_id, basic_minor, gross_minor, deductions_minor, net_minor, absent_days, lines').eq('staff_id', mine.id)
    : { data: [] };
  const runIds = (slips ?? []).map((s) => s.run_id);
  const { data: runs } = runIds.length ? await p.sb.from('payroll_runs').select('id, period').in('id', runIds) : { data: [] };
  const period = new Map((runs ?? []).map((r) => [r.id as string, String(r.period).slice(0, 7)]));
  const sorted = [...(slips ?? [])].sort((a, b) => (period.get(b.run_id) ?? '').localeCompare(period.get(a.run_id) ?? ''));
  return (
    <>
      <h1>{p.tr('finance.payslips.title')}</h1>
      {sorted.length === 0 ? <p className="muted">{mine ? p.l('No payslip has been posted for you yet. A payslip appears here after the accountant posts the month’s payroll.', 'آپ کی کوئی تنخواہ سلپ ابھی پوسٹ نہیں ہوئی۔ ماہانہ پے رول پوسٹ ہونے کے بعد یہاں نظر آئے گی۔') : p.l('Your login is not linked to a staff record, so there are no payslips to show. Ask the school owner to add you under Staff.', 'آپ کا لاگ اِن کسی اسٹاف ریکارڈ سے منسلک نہیں، اس لیے کوئی تنخواہ سلپ نہیں۔ مالک سے اسٹاف میں شامل کرنے کا کہیں۔')}</p> : sorted.map((s) => (
        <section key={s.id} className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }} className="ltr">{period.get(s.run_id)}</h2>
          <table className="grid"><tbody>
            <tr><td>{p.tr('finance.payslips.basic')}</td><td className="num">{p.fmt(s.basic_minor)}</td></tr>
            {((s.lines ?? []) as Line[]).map((l) => <tr key={l.code}><td>{l.name}</td><td className="num">{l.kind === 'earning' ? '' : '-'}{p.fmt(l.amount)}</td></tr>)}
            <tr><th>{p.tr('payroll.net')}</th><th className="num">{p.fmt(s.net_minor)}</th></tr>
          </tbody></table>
        </section>
      ))}
    </>
  );
}
