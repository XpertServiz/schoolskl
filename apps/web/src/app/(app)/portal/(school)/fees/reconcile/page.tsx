import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseBankCsv } from '@ilmora/providers';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Bank reconciliation', robots: { index: false, follow: false } };
const here = '/portal/fees/reconcile';
const uuid = z.string().uuid();

/** CSV layouts differ per bank, so the columns are mapped by the header names the person types — nothing here knows a specific bank. */
async function importCsv(form: FormData) {
  'use server';
  const file = form.get('file');
  const ref = String(form.get('ref') ?? '').trim();
  if (!(file instanceof File) || file.size === 0 || file.size > 2_000_000) return fail(here, { message: 'file?' });
  const col = (k: string) => String(form.get(k) ?? '').trim() || undefined;
  const fmt = z.enum(['iso', 'dmy', 'mdy']).safeParse(form.get('dateFormat'));
  if (!ref || !fmt.success || !col('date')) return fail(here, { message: 'mapping?' });
  const parsed = parseBankCsv(await file.text(), { date: col('date')!, dateFormat: fmt.data, description: col('description'), reference: col('reference'), credit: col('credit'), debit: col('debit'), amount: col('amount') });
  if (parsed.lines.length === 0) return fail(here, { message: parsed.skipped[0]?.reason ?? 'no credit lines found' });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('import_bank_statement', { p_statement_ref: ref, p_lines: parsed.lines });
  if (error) return fail(here, error);
  const r = (data as { inserted: number; skipped: number }[])[0] ?? { inserted: 0, skipped: 0 };
  revalidatePath(here);
  done(here, t(await getLocale(), 'finance.reconcile.imported', { n: r.inserted, s: r.skipped + parsed.skipped.length }));
}

async function autoMatch() {
  'use server';
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('reconcile_bank_lines');
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'finance.reconcile.matched', { n: Number(data ?? 0) }));
}

async function matchLine(form: FormData) {
  'use server';
  const [family, voucher] = String(form.get('target') ?? '').split(':');
  const line = uuid.safeParse(form.get('line')), f = uuid.safeParse(family), v = uuid.safeParse(voucher);
  if (!line.success || !f.success || !v.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('match_bank_line', { p_line: line.data, p_family: f.data, p_voucher: v.data });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function ignoreLine(form: FormData) {
  'use server';
  const line = uuid.safeParse(form.get('line'));
  if (!line.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('ignore_bank_line', { p_line: line.data, p_reason: String(form.get('reason') ?? '') });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Reconcile({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'fees.view');
  const sp = await searchParams;
  const canImport = p.can('accounts.journal.create'), canMatch = p.can('fees.collect');
  const [{ data: lines }, { data: open }] = await Promise.all([
    p.sb.from('bank_statement_lines').select('id, txn_date, description, reference, amount_minor, status, ignore_reason').order('txn_date', { ascending: false }).limit(200),
    p.sb.from('v_fee_aging').select('voucher_id, family_id, student_id, voucher_no, balance_minor').gt('balance_minor', 0).limit(500),
  ]);
  const ids = [...new Set((open ?? []).map((o) => o.student_id))];
  const { data: studs } = ids.length ? await p.sb.from('students').select('id, full_name').in('id', ids) : { data: [] };
  const sname = new Map((studs ?? []).map((s) => [s.id as string, s.full_name as string]));
  const unmatched = (lines ?? []).filter((l) => l.status === 'unmatched');
  return (
    <>
      <h1>{p.tr('finance.reconcile.title')}</h1>
      <Flash sp={sp} />
      {canMatch && unmatched.length ? <form action={autoMatch}><button className="btn secondary">{p.tr('finance.reconcile.auto')}</button></form> : null}

      <h2>{p.tr('finance.reconcile.unmatched')} ({unmatched.length})</h2>
      {unmatched.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.tr('ui.date')}</th><th>{p.tr('finance.reconcile.line')}</th><th className="num">{p.tr('ui.amount')}</th><th>{p.tr('ui.actions')}</th></tr></thead>
          <tbody>{unmatched.map((l) => (
            <tr key={l.id}>
              <td className="ltr">{l.txn_date}</td><td>{l.description}<br /><span className="muted ltr">{l.reference}</span></td><td className="num">{p.fmt(l.amount_minor)}</td>
              <td>{canMatch ? (<>
                <form action={matchLine} className="inline">
                  <input type="hidden" name="line" value={l.id} />
                  <select name="target" required aria-label={p.tr('finance.reconcile.matchTo')}>
                    <option value="">{p.tr('finance.reconcile.matchTo')}</option>
                    {(open ?? []).map((o) => <option key={o.voucher_id} value={`${o.family_id}:${o.voucher_id}`}>{o.voucher_no} · {sname.get(o.student_id)} · {p.fmt(o.balance_minor)}</option>)}
                  </select>
                  <button className="btn small">{p.tr('finance.reconcile.match')}</button>
                </form>
                <form action={ignoreLine} className="inline" style={{ marginTop: '.4rem' }}>
                  <input type="hidden" name="line" value={l.id} />
                  <input name="reason" required minLength={3} placeholder={p.tr('finance.concessions.reason')} />
                  <button className="btn secondary small">{p.tr('finance.reconcile.ignore')}</button>
                </form></>) : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {canImport ? (
        <>
          <h2>{p.tr('finance.reconcile.import')}</h2>
          <form action={importCsv} className="form card">
            <label>{p.tr('finance.reconcile.ref')}<input name="ref" required maxLength={80} className="ltr" /></label>
            <label>CSV<input type="file" name="file" accept=".csv,text/csv" required /></label>
            <p className="muted">{p.tr('finance.reconcile.mapHint')}</p>
            <label>{p.tr('finance.reconcile.colDate')}<input name="date" required className="ltr" defaultValue="Date" /></label>
            <label>{p.tr('finance.reconcile.dateFormat')}<select name="dateFormat"><option value="dmy">DD/MM/YYYY</option><option value="iso">YYYY-MM-DD</option><option value="mdy">MM/DD/YYYY</option></select></label>
            <label>{p.tr('finance.reconcile.colDesc')}<input name="description" className="ltr" defaultValue="Description" /></label>
            <label>{p.tr('finance.reconcile.colRef')}<input name="reference" className="ltr" defaultValue="Reference" /></label>
            <label>{p.tr('finance.reconcile.colCredit')}<input name="credit" className="ltr" defaultValue="Credit" /></label>
            <label>{p.tr('finance.reconcile.colAmount')}<input name="amount" className="ltr" /></label>
            <button className="btn">{p.tr('finance.reconcile.import')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
