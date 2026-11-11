import { Flash } from '@/components/flash';
import { act, str } from '@/lib/act';
import { rupeesToMinor } from '@/lib/money';
import { done, fail, need, portal } from '@/lib/portal';

export const metadata = { title: 'General journal', robots: { index: false, follow: false } };
const here = '/portal/accounts/journal';
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Up to 4 lines typed as account code + debit + credit (rupees). The ledger itself refuses an entry that does not balance. */
function readLines(f: FormData) {
  const lines: { a: string; d: number; c: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = str(f, `a${i}`);
    if (!a) continue;
    const d = str(f, `d${i}`) ? rupeesToMinor(str(f, `d${i}`)) : 0, c = str(f, `c${i}`) ? rupeesToMinor(str(f, `c${i}`)) : 0;
    if (d == null || c == null) return null;
    lines.push({ a: a.split(' ')[0]!, d, c });
  }
  return lines;
}

async function add(form: FormData) {
  'use server';
  const lines = readLines(form);
  if (!lines || lines.length < 2) return fail(here, { message: 'Enter at least two lines with valid amounts' });
  await act(here, 'OK', (sb) => sb.rpc('post_manual_journal', { p_date: str(form, 'date') || iso(new Date()), p_memo: str(form, 'memo'), p_lines: lines }));
}
async function amend(form: FormData) {
  'use server';
  const lines = readLines(form);
  if (!lines || lines.length < 2) return fail(here, { message: 'Enter at least two lines with valid amounts' });
  await act(here, 'OK', (sb) => sb.rpc('amend_manual_journal', { p_id: str(form, 'id'), p_date: str(form, 'date') || null, p_memo: str(form, 'memo'), p_lines: lines, p_reason: str(form, 'reason') }));
}
async function remove(form: FormData) {
  'use server';
  if (!str(form, 'reason')) return fail(here, { message: 'A reason is required' });
  await act(here, 'OK', (sb) => sb.rpc('void_manual_journal', { p_id: str(form, 'id'), p_reason: str(form, 'reason') }));
}

type Entry = { entry_id: string; entry_date: string; memo: string; source_type: string; reversal_of: string | null; reversed: boolean; total_minor: number; lines: { code: string; name: string; debit: number; credit: number }[] };

export default async function Journal({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; from?: string; to?: string; edit?: string }> }) {
  const p = await portal();
  need(p, 'accounts.reports.view', 'accounts.journal.create');
  const sp = await searchParams;
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const to = ok(sp.to) ?? iso(new Date());
  const from = ok(sp.from) ?? iso(new Date(Date.now() - 30 * 86400000));
  const [{ data }, { data: accounts }] = await Promise.all([
    p.sb.rpc('journal_list', { p_from: from, p_to: to }),
    p.sb.from('accounts').select('code, name').eq('is_active', true).order('code'),
  ]);
  const list = (data ?? []) as Entry[];
  const create = p.can('accounts.journal.create');
  const decide = p.can('accounts.journal.approve');
  const src = (s: string) => ({ manual: p.l('Manual', 'دستی'), reversal: p.l('Reversal', 'ریورسل') } as Record<string, string>)[s] ?? s;
  const editing = list.find((e) => e.entry_id === sp.edit);
  const LineInputs = ({ pre }: { pre?: Entry['lines'] }) => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="inline">
          <select name={`a${i}`} defaultValue={pre?.[i]?.code ?? ''}><option value="">{p.l('— account —', '— اکاؤنٹ —')}</option>{(accounts ?? []).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
          <input name={`d${i}`} inputMode="decimal" placeholder={p.l('Debit', 'ڈیبٹ')} defaultValue={pre?.[i] && Number(pre[i]!.debit) ? String(Number(pre[i]!.debit) / 100) : ''} className="ltr" />
          <input name={`c${i}`} inputMode="decimal" placeholder={p.l('Credit', 'کریڈٹ')} defaultValue={pre?.[i] && Number(pre[i]!.credit) ? String(Number(pre[i]!.credit) / 100) : ''} className="ltr" />
        </div>
      ))}
    </>
  );
  return (
    <>
      <h1>{p.l('General journal', 'جنرل جرنل')}</h1>
      <Flash sp={sp} />
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <label className="inline">{p.l('From', 'از')}<input type="date" name="from" defaultValue={from} className="ltr" /></label>
        <label className="inline">{p.l('To', 'تا')}<input type="date" name="to" defaultValue={to} className="ltr" /></label>
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>
      {list.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{p.l('Date', 'تاریخ')}</th><th>{p.l('Memo', 'تفصیل')}</th><th>{p.l('Lines', 'لائنیں')}</th><th className="num">{p.l('Amount', 'رقم')}</th><th>{p.l('Type', 'قسم')}</th><th /></tr></thead>
          <tbody>{list.map((e) => (
            <tr key={e.entry_id} style={e.reversed ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
              <td className="ltr">{e.entry_date}</td><td>{e.memo}</td>
              <td className="ltr" style={{ fontSize: '.85em' }}>{e.lines.map((l) => `${l.code} ${Number(l.debit) ? 'Dr ' + p.fmt(l.debit) : 'Cr ' + p.fmt(l.credit)}`).join(' · ')}</td>
              <td className="num">{p.fmt(e.total_minor)}</td>
              <td><span className="pill">{src(e.source_type)}</span>{e.reversed ? <span className="pill">{p.l('reversed', 'ریورس')}</span> : null}</td>
              <td>{e.source_type === 'manual' && !e.reversed && !e.reversal_of && (decide || p.can('accounts.journal.create')) ? <a className="btn secondary small" href={`${here}?edit=${e.entry_id}&from=${from}&to=${to}#edit`}>{p.l('Modify / delete', 'ترمیم / حذف')}</a> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing ? (
        <div className="card" id="edit">
          <h2 style={{ marginTop: 0 }}>{p.l('Modify or delete entry', 'اندراج میں ترمیم یا حذف')}</h2>
          <p className="muted">{p.l('The original is reversed and (for a change) the corrected entry is posted — the history stays visible. Needs owner or journal approver.', 'اصل اندراج ریورس ہوتا ہے اور (ترمیم میں) درست اندراج پوسٹ ہوتا ہے — تاریخ نظر آتی رہتی ہے۔ مالک یا جرنل منظور کنندہ درکار ہے۔')}</p>
          <form action={amend} className="form">
            <input type="hidden" name="id" value={editing.entry_id} />
            <label>{p.l('Date', 'تاریخ')}<input type="date" name="date" defaultValue={editing.entry_date} className="ltr" /></label>
            <label>{p.l('Memo', 'تفصیل')}<input name="memo" defaultValue={editing.memo} /></label>
            <LineInputs pre={editing.lines} />
            <label>{p.l('Reason (required)', 'وجہ (لازمی)')}<input name="reason" required minLength={3} /></label>
            <button className="btn">{p.l('Save change', 'تبدیلی محفوظ کریں')}</button>
          </form>
          <form action={remove} className="inline" style={{ marginTop: '1rem' }}>
            <input type="hidden" name="id" value={editing.entry_id} />
            <input name="reason" required minLength={3} placeholder={p.l('Reason to delete', 'حذف کی وجہ')} />
            <button className="btn secondary">{p.l('Delete (reverse) entry', 'اندراج حذف (ریورس)')}</button>
          </form>
        </div>
      ) : null}
      {create ? (
        <form action={add} className="form card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>{p.l('New journal entry', 'نیا جرنل اندراج')}</h2>
          <label>{p.l('Date', 'تاریخ')}<input type="date" name="date" defaultValue={iso(new Date())} className="ltr" /></label>
          <label>{p.l('Memo', 'تفصیل')}<input name="memo" required minLength={3} /></label>
          <LineInputs />
          <p className="muted">{p.l('Total debit must equal total credit. Amounts in rupees.', 'کل ڈیبٹ اور کل کریڈٹ برابر ہوں۔ رقم روپوں میں۔')}</p>
          <button className="btn">{p.l('Post entry', 'اندراج پوسٹ کریں')}</button>
        </form>
      ) : null}
    </>
  );
}
void done;
