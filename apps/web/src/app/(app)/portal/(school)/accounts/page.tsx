import { need, portal } from '@/lib/portal';

export const metadata = { title: 'Accounts', robots: { index: false, follow: false } };

interface Closing {
  date: string; billed_minor: number; collected_by_channel: Record<string, number> | null; receivable_minor: number; cash_in_hand_minor: number;
  overdue_vouchers: number; issued: number; open_cashier_sessions: number; trial_balance_ok: boolean;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Reads only: P&L, balance sheet and the day's closing figures. All numbers come from the ledger; nothing here is recomputed in the browser. */
export default async function Accounts({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const p = await portal();
  need(p, 'accounts.reports.view');
  const sp = await searchParams;
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const today = iso(new Date());
  const to = ok(sp.to) ?? today;
  const from = ok(sp.from) ?? `${to.slice(0, 7)}-01`;
  const [{ data: pl }, { data: bs }, { data: cl }] = await Promise.all([
    p.sb.rpc('profit_loss', { p_from: from, p_to: to }),
    p.sb.rpc('balance_sheet', { p_as_of: to }),
    p.sb.rpc('daily_closing_report', { p_date: to }),
  ]);
  const rows = (pl ?? []) as { code: string; name: string; type: string; amount: number }[];
  const income = rows.filter((r) => r.type === 'income' && Number(r.amount) !== 0), expense = rows.filter((r) => r.type === 'expense' && Number(r.amount) !== 0);
  const sum = (r: { amount: number }[]) => r.reduce((a, x) => a + Number(x.amount), 0);
  const sheet = (bs ?? []) as { section: string; code: string; name: string; amount: number }[];
  const c = cl as Closing | null;
  const Block = ({ title, items }: { title: string; items: { code: string; name: string; amount: number }[] }) => (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table className="grid"><tbody>
        {items.map((i) => <tr key={i.code}><td className="ltr">{i.code}</td><td>{i.name}</td><td className="num">{p.fmt(i.amount)}</td></tr>)}
        <tr><th colSpan={2}>{p.tr('ui.total')}</th><th className="num">{p.fmt(sum(items))}</th></tr>
      </tbody></table>
    </section>
  );
  return (
    <>
      <h1>{p.tr('finance.accounts.title')}</h1>
      <form className="inline" style={{ marginBottom: '1rem' }}>
        <label className="inline">{p.tr('finance.accounts.from')}<input type="date" name="from" defaultValue={from} className="ltr" /></label>
        <label className="inline">{p.tr('finance.accounts.to')}<input type="date" name="to" defaultValue={to} className="ltr" /></label>
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>

      {c ? (
        <div className="stats">
          <div className="card stat"><span className="num">{p.fmt(c.billed_minor)}</span><span className="label">{p.tr('finance.accounts.billed')}</span></div>
          <div className="card stat"><span className="num">{p.fmt(Object.values(c.collected_by_channel ?? {}).reduce((a, x) => a + Number(x), 0))}</span><span className="label">{p.tr('finance.accounts.collected')}</span></div>
          <div className="card stat"><span className="num">{p.fmt(c.receivable_minor)}</span><span className="label">{p.tr('cockpit.outstanding')}</span></div>
          <div className="card stat"><span className="num">{p.fmt(c.cash_in_hand_minor)}</span><span className="label">{p.tr('finance.accounts.cash')}</span></div>
          <div className="card stat"><span className="num">{c.trial_balance_ok ? '✓' : '✗'}</span><span className="label">{p.tr('finance.accounts.balanced')}</span></div>
        </div>
      ) : null}

      <h2>{p.tr('finance.accounts.pl')}</h2>
      <div className="stats"><Block title={p.tr('finance.accounts.income')} items={income} /><Block title={p.tr('finance.accounts.expense')} items={expense} /></div>
      <p><strong>{p.tr('finance.accounts.surplus')}: <span className="ltr">{p.fmt(sum(income) - sum(expense))}</span></strong></p>

      <h2>{p.tr('finance.accounts.bs')}</h2>
      <div className="stats">
        {(['assets', 'liabilities', 'equity'] as const).map((s) => <Block key={s} title={p.tr(`finance.accounts.${s}`)} items={sheet.filter((r) => r.section === s && Number(r.amount) !== 0)} />)}
      </div>
    </>
  );
}
