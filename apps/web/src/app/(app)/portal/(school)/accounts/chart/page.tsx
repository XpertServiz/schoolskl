import { Flash } from '@/components/flash';
import { act, str } from '@/lib/act';
import { need, portal } from '@/lib/portal';

export const metadata = { title: 'Chart of accounts', robots: { index: false, follow: false } };
const here = '/portal/accounts/chart';

async function add(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('add_account', { p_code: str(form, 'code'), p_name: str(form, 'name'), p_type: str(form, 'type') }));
}
async function update(form: FormData) {
  'use server';
  await act(here, 'OK', (sb) => sb.rpc('update_account', { p_id: str(form, 'id'), p_name: str(form, 'name'), p_active: form.get('active') === 'on' }));
}

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export default async function Chart({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'accounts.reports.view', 'accounts.chart.edit');
  const sp = await searchParams;
  const { data } = await p.sb.from('accounts').select('id, code, name, type, is_active, is_system').order('code');
  const edit = p.can('accounts.chart.edit');
  const typeName = (x: string) => p.l(x[0]!.toUpperCase() + x.slice(1), ({ asset: 'اثاثے', liability: 'واجبات', equity: 'ایکویٹی', income: 'آمدنی', expense: 'اخراجات' } as Record<string, string>)[x] ?? x);
  return (
    <>
      <h1>{p.l('Chart of accounts', 'چارٹ آف اکاؤنٹس')}</h1>
      <Flash sp={sp} />
      <div className="table-scroll"><table className="grid">
        <thead><tr><th>{p.l('Code', 'کوڈ')}</th><th>{p.l('Account', 'اکاؤنٹ')}</th><th>{p.l('Type', 'قسم')}</th>{edit ? <th /> : null}</tr></thead>
        <tbody>{(data ?? []).map((a) => (
          <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.55 }}>
            <td className="ltr">{a.code}</td>
            {edit && !a.is_system ? (
              <td colSpan={3}>
                <form action={update} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="name" defaultValue={a.name} required minLength={2} />
                  <span className="pill">{typeName(a.type)}</span>
                  <label className="inline"><input type="checkbox" name="active" defaultChecked={a.is_active} /> {p.l('Active', 'فعال')}</label>
                  <button className="btn secondary small">{p.l('Save', 'محفوظ کریں')}</button>
                </form>
              </td>
            ) : <><td>{a.name}</td><td>{typeName(a.type)}</td></>}
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted">{p.l('Accounts that already have entries cannot be deleted — switch them off instead. The ledger history is never rewritten.', 'جن اکاؤنٹس میں اندراجات ہوں انہیں حذف نہیں کیا جا سکتا — بند کر دیں۔ لیجر کی تاریخ کبھی تبدیل نہیں ہوتی۔')}</p>
      {edit ? (
        <form action={add} className="form card">
          <h2 style={{ marginTop: 0 }}>{p.l('Add an account', 'نیا اکاؤنٹ')}</h2>
          <label>{p.l('Code (5 digits)', 'کوڈ (5 ہندسے)')}<input name="code" required pattern="[0-9]{5}" className="ltr" /></label>
          <label>{p.l('Name', 'نام')}<input name="name" required minLength={2} maxLength={80} /></label>
          <label>{p.l('Type', 'قسم')}<select name="type">{TYPES.map((x) => <option key={x} value={x}>{typeName(x)}</option>)}</select></label>
          <button className="btn">{p.l('Add account', 'اکاؤنٹ شامل کریں')}</button>
        </form>
      ) : null}
    </>
  );
}
