import Link from 'next/link';
import { need, portal } from '@/lib/portal';

export const metadata = { title: 'Reports', robots: { index: false, follow: false } };
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Row = Record<string, unknown>;
const REPORTS = ['pl', 'bs', 'tb', 'gl', 'cash', 'aged', 'payables', 'daily'] as const;
type Rep = (typeof REPORTS)[number];

/** All reports are read straight from the ledger by the database (no recomputation here). Who sees what is decided by the database too. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string; acct?: string; csv?: string }> }) {
  const p = await portal();
  need(p, 'accounts.reports.view', 'fees.view');
  const sp = await searchParams;
  const r: Rep = (REPORTS as readonly string[]).includes(sp.r ?? '') ? (sp.r as Rep) : 'pl';
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const to = ok(sp.to) ?? iso(new Date());
  const from = ok(sp.from) ?? `${to.slice(0, 7)}-01`;
  const books = p.can('accounts.reports.view');
  const names: Record<Rep, [string, string]> = {
    pl: ['Profit & loss', 'نفع و نقصان'], bs: ['Balance sheet', 'بیلنس شیٹ'], tb: ['Trial balance', 'ٹرائل بیلنس'], gl: ['General ledger', 'جنرل لیجر'],
    cash: ['Cash flow', 'کیش فلو'], aged: ['Aged receivables (fees)', 'بقایا فیس بلحاظ عمر'], payables: ['Payables', 'قابل ادا رقوم'], daily: ['Daily closing', 'روزانہ اختتام'],
  };
  const { data: accts } = r === 'gl' ? await p.sb.from('accounts').select('id, code, name').order('code') : { data: [] as { id: string; code: string; name: string }[] };
  const acct = sp.acct ?? accts?.[0]?.id;
  const res =
    r === 'pl' ? await p.sb.rpc('profit_loss', { p_from: from, p_to: to })
    : r === 'bs' ? await p.sb.rpc('balance_sheet', { p_as_of: to })
    : r === 'tb' ? await p.sb.rpc('report_trial_balance', { p_to: to })
    : r === 'gl' ? (acct ? await p.sb.rpc('report_general_ledger', { p_account: acct, p_from: from, p_to: to }) : { data: [], error: null })
    : r === 'cash' ? await p.sb.rpc('report_cash_flow', { p_from: from, p_to: to })
    : r === 'aged' ? await p.sb.rpc('report_aged_receivables', { p_as_of: to })
    : r === 'payables' ? await p.sb.rpc('report_payables', { p_as_of: to })
    : await p.sb.rpc('daily_closing_report', { p_date: to });
  const rows: Row[] = Array.isArray(res.data) ? (res.data as Row[]) : res.data ? Object.entries(res.data as Row).map(([k, v]) => ({ item: k, value: typeof v === 'object' ? JSON.stringify(v) : v })) : [];
  const money = (k: string) => /(_minor|amount|debit|credit|balance|inflow|outflow|current_amt|^d\d|total|amt)/.test(k) && k !== 'code';
  const label = (k: string) => k.replace(/_minor$/, '').replace(/_/g, ' ');
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const nonZero = rows.filter((x) => cols.some((c) => money(c) && Number(x[c]) !== 0) || !cols.some(money));
  const q = (o: Record<string, string>) => '?' + new URLSearchParams({ r, from, to, ...o }).toString();
  const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent([cols.join(','), ...nonZero.map((x) => cols.map((c) => JSON.stringify(x[c] ?? '')).join(','))].join('\n'));
  return (
    <>
      <h1>{p.l('Reports', 'رپورٹس')}</h1>
      <nav className="tabs no-print" aria-label="Reports">
        {REPORTS.filter((x) => books || x === 'aged' || x === 'daily').map((x) => <Link key={x} href={q({ r: x })} className={x === r ? 'active' : ''} aria-current={x === r ? 'page' : undefined}>{p.l(...names[x])}</Link>)}
      </nav>
      <form className="inline no-print" style={{ margin: '1rem 0' }}>
        <input type="hidden" name="r" value={r} />
        {['pl', 'cash', 'gl'].includes(r) ? <label className="inline">{p.l('From', 'از')}<input type="date" name="from" defaultValue={from} className="ltr" /></label> : null}
        <label className="inline">{['pl', 'cash', 'gl'].includes(r) ? p.l('To', 'تا') : p.l('As of', 'تاریخ تک')}<input type="date" name="to" defaultValue={to} className="ltr" /></label>
        {r === 'gl' ? <label className="inline">{p.l('Account', 'اکاؤنٹ')}<select name="acct" defaultValue={acct}>{(accts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label> : null}
        <button className="btn secondary small">{p.tr('common.search')}</button>
        <a className="btn secondary small" href={csv} download={`${r}-${to}.csv`}>CSV</a>
        <button type="button" className="btn secondary small" data-print>{p.l('Print', 'پرنٹ')}</button>
      </form>
      <h2>{p.l(...names[r])} <span className="muted ltr" style={{ fontSize: '.6em' }}>{['pl', 'cash', 'gl'].includes(r) ? `${from} → ${to}` : to}</span></h2>
      {res.error ? <p role="alert" className="notice">{res.error.message}</p> : nonZero.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr>{cols.map((c) => <th key={c} className={money(c) ? 'num' : ''}>{label(c)}</th>)}</tr></thead>
          <tbody>{nonZero.map((x, i) => <tr key={i}>{cols.map((c) => <td key={c} className={money(c) ? 'num' : 'ltr'}>{money(c) && x[c] != null && !Number.isNaN(Number(x[c])) ? p.fmt(x[c] as number) : String(x[c] ?? '')}</td>)}</tr>)}</tbody>
          {r === 'tb' ? <tfoot><tr><th colSpan={3}>{p.tr('ui.total')}</th><th className="num">{p.fmt(nonZero.reduce((a, x) => a + Number(x.debit), 0))}</th><th className="num">{p.fmt(nonZero.reduce((a, x) => a + Number(x.credit), 0))}</th></tr></tfoot> : null}
        </table></div>
      )}
      <script dangerouslySetInnerHTML={{ __html: "document.querySelectorAll('[data-print]').forEach(function(b){b.addEventListener('click',function(){window.print()})})" }} />
    </>
  );
}
