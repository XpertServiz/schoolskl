import Link from 'next/link';
import { Flash } from '@/components/flash';
import { act, str } from '@/lib/act';
import { rupeesToMinor } from '@/lib/money';
import { fail, need, portal } from '@/lib/portal';

export const metadata = { title: 'Bank reconciliation', robots: { index: false, follow: false } };
const here = '/portal/accounts/bank';
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function autoReconcile() {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('reconcile_bank_lines'));
}
/** Something the bank has that the books do not (fees, interest, other receipts/payments): posts to the books at once. */
async function addEntry(form: FormData) {
  'use server';
  const amt = rupeesToMinor(str(form, 'amount'));
  if (!amt || amt <= 0) return fail(here, { message: 'Amount?' });
  await act(here, 'OK', (sb) => sb.rpc('post_bank_entry', { p_date: str(form, 'date') || iso(new Date()), p_memo: str(form, 'memo'), p_amount_minor: amt, p_kind: str(form, 'kind'), p_account_code: str(form, 'account') }));
}
async function postLine(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('post_bank_line', { p_line: str(form, 'line'), p_account_code: str(form, 'account') }));
}
async function finish(form: FormData) {
  'use server';
  const bal = rupeesToMinor(str(form, 'statement'));
  if (bal == null) return fail(here, { message: 'Statement balance?' });
  await act(here, 'OK', (sb) => sb.rpc('save_bank_reconciliation', { p_as_of: str(form, 'asof'), p_statement_balance: bal, p_note: str(form, 'note') }));
}

export default async function Bank({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; asof?: string; statement?: string }> }) {
  const p = await portal();
  need(p, 'accounts.journal.create', 'accounts.reports.view', 'fees.collect');
  const sp = await searchParams;
  const asof = sp.asof && /^\d{4}-\d{2}-\d{2}$/.test(sp.asof) ? sp.asof : iso(new Date());
  const stmtMinor = sp.statement ? rupeesToMinor(sp.statement) : null;
  const write = p.can('accounts.journal.create');
  const [{ data: book }, { data: lines }, { data: accounts }, { data: history }] = await Promise.all([
    p.sb.rpc('bank_book_balance', { p_as_of: asof }),
    p.sb.from('bank_statement_lines').select('id, txn_date, description, reference, amount_minor, status').eq('status', 'unmatched').order('txn_date').limit(200),
    p.sb.from('accounts').select('code, name, type').eq('is_active', true).neq('code', '10200').order('code'),
    p.sb.from('bank_reconciliations').select('id, as_of, statement_balance_minor, book_balance_minor, difference_minor, note, created_at').order('created_at', { ascending: false }).limit(12),
  ]);
  const bookMinor = Number(book ?? 0);
  const diff = stmtMinor == null ? null : stmtMinor - bookMinor;
  const accOpts = (accounts ?? []).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>);
  return (
    <>
      <h1>{p.l('Bank reconciliation', 'بینک ریکنسلی ایشن')}</h1>
      <Flash sp={sp} />
      <form className="inline card" style={{ marginBottom: '1rem' }}>
        <label className="inline">{p.l('As of', 'تاریخ تک')}<input type="date" name="asof" defaultValue={asof} className="ltr" /></label>
        <label className="inline">{p.l('Balance on your bank statement', 'بینک اسٹیٹمنٹ کا بیلنس')}<input name="statement" defaultValue={sp.statement ?? ''} inputMode="decimal" className="ltr" /></label>
        <button className="btn secondary small">{p.l('Compare', 'موازنہ')}</button>
      </form>
      <div className="stats">
        <div className="card stat"><span className="num">{p.fmt(bookMinor)}</span><span className="label">{p.l('Balance in your books', 'آپ کی کتابوں میں بیلنس')}</span></div>
        {diff != null ? (
          <>
            <div className="card stat"><span className="num">{p.fmt(stmtMinor)}</span><span className="label">{p.l('Bank statement', 'بینک اسٹیٹمنٹ')}</span></div>
            <div className="card stat"><span className="num" style={{ color: diff === 0 ? 'var(--ok, #35c37a)' : 'var(--danger)' }}>{diff === 0 ? '✓ 0' : p.fmt(diff)}</span><span className="label">{p.l('Difference', 'فرق')}</span></div>
          </>
        ) : null}
      </div>
      {diff != null && diff !== 0 ? <p className="notice" role="status">{p.l('The difference is made of transactions the bank has but your books do not (charges, interest, deposits) — add them below, or match fee payments from the statement. Everything you add is posted to the financial statements immediately.', 'فرق ان لین دین کا ہے جو بینک میں ہیں مگر کتابوں میں نہیں (چارجز، منافع، جمع) — نیچے شامل کریں، یا اسٹیٹمنٹ سے فیس کی ادائیگیاں میچ کریں۔ جو شامل کریں گے وہ فوراً مالی گوشواروں میں پوسٹ ہوگا۔')}</p> : null}
      {diff === 0 && write ? (
        <form action={finish} className="inline card">
          <input type="hidden" name="asof" value={asof} /><input type="hidden" name="statement" value={sp.statement ?? ''} />
          <input name="note" placeholder={p.l('Note (optional)', 'نوٹ (اختیاری)')} />
          <button className="btn">{p.l('Mark as reconciled', 'ریکنسائلڈ لکھیں')}</button>
        </form>
      ) : null}
      {diff != null && diff !== 0 && write ? (
        <form action={finish} className="inline">
          <input type="hidden" name="asof" value={asof} /><input type="hidden" name="statement" value={sp.statement ?? ''} />
          <input name="note" placeholder={p.l('Note: why a difference remains', 'نوٹ: فرق کیوں باقی ہے')} />
          <button className="btn secondary small">{p.l('Save with difference', 'فرق کے ساتھ محفوظ کریں')}</button>
        </form>
      ) : null}

      <h2>{p.l('Statement lines to handle', 'اسٹیٹمنٹ کی بقایا لائنیں')}</h2>
      <div className="inline" style={{ marginBottom: '.75rem' }}>
        {write ? <form action={autoReconcile}><button className="btn">{p.l('Auto-reconcile fee payments', 'فیس ادائیگیاں خودکار میچ کریں')}</button></form> : null}
        <Link className="btn secondary" href="/portal/fees/reconcile">{p.l('Import statement (CSV) & match manually', 'اسٹیٹمنٹ (CSV) درآمد اور دستی میچ')}</Link>
      </div>
      {(lines ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.l('Date', 'تاریخ')}</th><th>{p.l('Description', 'تفصیل')}</th><th className="num">{p.l('Amount', 'رقم')}</th>{write ? <th>{p.l('Post to the books as', 'کتابوں میں بطور پوسٹ')}</th> : null}</tr></thead>
          <tbody>{(lines ?? []).map((l) => (
            <tr key={l.id}>
              <td className="ltr">{l.txn_date}</td><td>{l.description || l.reference}</td><td className="num">{p.fmt(l.amount_minor)}</td>
              {write ? <td><form action={postLine} className="inline"><input type="hidden" name="line" value={l.id} /><select name="account">{accOpts}</select><button className="btn secondary small">{p.l('Post', 'پوسٹ')}</button></form></td> : null}
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {write ? (
        <form action={addEntry} className="form card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>{p.l('Add a transaction the bank has', 'بینک کا لین دین شامل کریں')}</h2>
          <label>{p.l('Date', 'تاریخ')}<input type="date" name="date" defaultValue={iso(new Date())} className="ltr" /></label>
          <label>{p.l('Kind', 'قسم')}<select name="kind"><option value="payment">{p.l('Money out (bank charge, payment)', 'رقم نکلی (بینک چارج، ادائیگی)')}</option><option value="deposit">{p.l('Money in (interest, other deposit)', 'رقم آئی (منافع، دیگر جمع)')}</option></select></label>
          <label>{p.l('Other side of the entry (account)', 'اندراج کا دوسرا رخ (اکاؤنٹ)')}<select name="account">{accOpts}</select></label>
          <label>{p.l('Amount', 'رقم')}<input name="amount" required inputMode="decimal" className="ltr" /></label>
          <label>{p.l('Memo', 'تفصیل')}<input name="memo" /></label>
          <button className="btn">{p.l('Post to books', 'کتابوں میں پوسٹ کریں')}</button>
        </form>
      ) : null}

      {(history ?? []).length ? (
        <>
          <h2>{p.l('Past reconciliations', 'پچھلی ریکنسلی ایشنز')}</h2>
          <div className="table-scroll"><table className="grid">
            <thead><tr><th>{p.l('As of', 'تاریخ')}</th><th className="num">{p.l('Statement', 'اسٹیٹمنٹ')}</th><th className="num">{p.l('Books', 'کتابیں')}</th><th className="num">{p.l('Difference', 'فرق')}</th><th>{p.l('Note', 'نوٹ')}</th></tr></thead>
            <tbody>{(history ?? []).map((h) => <tr key={h.id}><td className="ltr">{h.as_of}</td><td className="num">{p.fmt(h.statement_balance_minor)}</td><td className="num">{p.fmt(h.book_balance_minor)}</td><td className="num">{p.fmt(h.difference_minor)}</td><td>{h.note}</td></tr>)}</tbody>
          </table></div>
        </>
      ) : null}
    </>
  );
}
