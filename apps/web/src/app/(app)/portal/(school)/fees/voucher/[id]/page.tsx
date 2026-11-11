import { notFound } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { Flash } from '@/components/flash';
import { PrintButton } from '@/components/print-button';
import { rupeesToMinor, minorToInput } from '@/lib/money';
import { done, fail, getLocale, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Fee challan', robots: { index: false, follow: false } };

// Staff actions on a voucher. Each is one RPC that owns its rule (permission, maker-checker, 60-day promise window, reversal journals).
const voucherPath = (id: string) => `/portal/fees/voucher/${id}`;

async function createPlan(form: FormData) {
  'use server';
  const id = z.string().uuid().parse(form.get('voucher'));
  const dates = String(form.get('dates') ?? '').split(/[\s,]+/).filter(Boolean);
  if (!dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) return fail(voucherPath(id), { message: 'YYYY-MM-DD' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('create_installment_plan', { p_voucher: id, p_dates: dates, p_note: String(form.get('note') ?? '').trim() || null });
  if (error) return fail(voucherPath(id), error);
  revalidatePath(voucherPath(id));
  done(voucherPath(id), t(await getLocale(), 'finance.voucher.planCreated'));
}

async function promise(form: FormData) {
  'use server';
  const r = z.object({ id: z.string().uuid(), family: z.string().uuid(), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ id: form.get('voucher'), family: form.get('family'), on: form.get('on') });
  if (!r.success) return fail('/portal/fees', { message: 'invalid' });
  const amount = rupeesToMinor(String(form.get('amount') ?? ''));
  if (amount == null || amount <= 0) return fail(voucherPath(r.data.id), { message: 'amount?' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('record_promise', { p_family: r.data.family, p_amount: amount, p_on: r.data.on, p_note: String(form.get('note') ?? '').trim() || null, p_voucher: r.data.id });
  if (error) return fail(voucherPath(r.data.id), error);
  revalidatePath(voucherPath(r.data.id));
  done(voucherPath(r.data.id), t(await getLocale(), 'finance.voucher.promiseSaved'));
}

async function cancel(form: FormData) {
  'use server';
  const id = z.string().uuid().parse(form.get('voucher'));
  const sb = await supabaseServer();
  const { error } = await sb.rpc('cancel_voucher', { p_voucher: id, p_reason: String(form.get('reason') ?? '') });
  if (error) return fail(voucherPath(id), error);
  revalidatePath(voucherPath(id));
  done(voucherPath(id), t(await getLocale(), 'finance.voucher.cancelled'));
}

/**
 * Printable 3-part challan (parent / bank / school). It is plain HTML + CSS on purpose: the browser's print dialog gives a correct PDF
 * with Urdu shaping, which server-side PDF libraries still get wrong. Everything shown is the voucher's frozen snapshot — the amounts
 * on the paper are exactly the amounts in the books. RLS decides who may open it (staff with fees.view, or a guardian of that family).
 * DECISION: no QR yet. A scannable Raast/1Link code needs the partner's merchant template (open question 4); the consumer number below is
 * what banks and 1Bill accept today. packages/providers already builds the QR once the template is supplied.
 */
export default async function Challan({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const p = await portal();

  const { data: v } = await p.sb.from('vouchers').select('id, family_id, student_id, voucher_no, consumer_no, period, due_date, status, total_minor, adjusted_minor, paid_minor, gross_minor, concession_minor').eq('id', id).maybeSingle();
  if (!v) notFound();
  const [{ data: lines }, { data: adj }, { data: s }] = await Promise.all([
    p.sb.from('voucher_lines').select('description, amount_minor, kind').eq('voucher_id', id).order('created_at'),
    p.sb.from('voucher_adjustments').select('kind, amount_minor, reason').eq('voucher_id', id).order('created_at'),
    p.sb.from('students').select('full_name, admission_no').eq('id', v.student_id).maybeSingle(),
  ]);
  const balance = Number(v.total_minor) + Number(v.adjusted_minor) - Number(v.paid_minor);
  const month = new Date(`${v.period}T00:00:00Z`).toLocaleDateString(p.locale === 'ur' ? 'ur-PK' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const Copy = ({ label }: { label: string }) => (
    <section className="copy" aria-label={label}>
      <h3>{p.access.tenant.name} · {p.tr('fees.challan')}</h3>
      <p className="ltr" style={{ margin: 0 }}><strong>{label}</strong> — {month}</p>
      <table>
        <tbody>
          <tr><th>{p.tr('fees.student')}</th><td>{s?.full_name} <span className="ltr">({s?.admission_no})</span></td></tr>
          <tr><th>{p.tr('fees.voucher')}</th><td className="ltr">{v.voucher_no}</td></tr>
          <tr><th>{p.tr('fees.consumerNo')}</th><td className="ltr"><strong>{v.consumer_no}</strong></td></tr>
          <tr><th>{p.tr('ui.due')}</th><td className="ltr">{v.due_date}</td></tr>
        </tbody>
      </table>
      <table>
        <tbody>
          {(lines ?? []).map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{p.fmt(l.amount_minor)}</td></tr>)}
          {(adj ?? []).map((a, i) => <tr key={`a${i}`}><td>{a.reason ?? a.kind}</td><td className="num">{a.kind === 'fine' ? '' : '-'}{p.fmt(a.amount_minor)}</td></tr>)}
          {Number(v.paid_minor) > 0 ? <tr><td>{p.tr('ui.paid')}</td><td className="num">-{p.fmt(v.paid_minor)}</td></tr> : null}
          <tr><th>{p.tr('fees.ourDue', { date: v.due_date })}</th><th className="num">{p.fmt(balance)}</th></tr>
        </tbody>
      </table>
      <p style={{ fontSize: '.85em' }}>{p.tr('fees.payInstructions')}</p>
    </section>
  );

  return (
    <>
      <p className="no-print inline"><Link href="/portal/fees">← {p.tr('ui.back')}</Link><PrintButton label={p.tr('ui.print')} /></p>
      {v.status === 'cancelled' ? <p role="alert" className="flash err">{p.tr('ui.cancelled')}</p> : null}
      <div className="challan">
        <Copy label={p.tr('fees.parentCopy')} />
        <Copy label={p.tr('fees.bankCopy')} />
        <Copy label={p.tr('fees.schoolCopy')} />
      </div>
      <div className="no-print">
        <Flash sp={sp} />
        {v.status !== 'cancelled' && balance > 0 && p.can('fees.concession.approve') ? (
          <form action={createPlan} className="form card" style={{ marginTop: '1.5rem' }}>
            <h3 style={{ margin: 0 }}>{p.tr('finance.voucher.plan')}</h3>
            <input type="hidden" name="voucher" value={v.id} />
            <label>{p.tr('finance.voucher.planDates')}<textarea name="dates" rows={3} required className="ltr" placeholder="2026-12-05&#10;2027-01-05" /></label>
            <label>{p.tr('finance.concessions.reason')}<input name="note" maxLength={200} /></label>
            <button className="btn secondary">{p.tr('finance.voucher.plan')}</button>
          </form>
        ) : null}
        {v.status !== 'cancelled' && balance > 0 && p.can('fees.collect') ? (
          <form action={promise} className="form card" style={{ marginTop: '1rem' }}>
            <h3 style={{ margin: 0 }}>{p.tr('finance.voucher.promise')}</h3>
            <input type="hidden" name="voucher" value={v.id} /><input type="hidden" name="family" value={v.family_id} />
            <label>{p.tr('ui.amount')}<input name="amount" required inputMode="decimal" className="ltr" defaultValue={minorToInput(balance)} /></label>
            <label>{p.tr('finance.voucher.promiseDate')}<input name="on" type="date" required className="ltr" /></label>
            <label>{p.tr('finance.concessions.reason')}<input name="note" maxLength={200} /></label>
            <button className="btn secondary">{p.tr('finance.voucher.promise')}</button>
          </form>
        ) : null}
        {v.status !== 'cancelled' && p.can('fees.voucher.cancel') ? (
          <form action={cancel} className="form card" style={{ marginTop: '1rem' }}>
            <h3 style={{ margin: 0 }}>{p.tr('finance.voucher.cancel')}</h3>
            <input type="hidden" name="voucher" value={v.id} />
            <label>{p.tr('finance.concessions.reason')}<input name="reason" required minLength={3} maxLength={200} /></label>
            <p className="muted">{p.tr('finance.voucher.cancelNote')}</p>
            <button className="btn secondary">{p.tr('finance.voucher.cancel')}</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
