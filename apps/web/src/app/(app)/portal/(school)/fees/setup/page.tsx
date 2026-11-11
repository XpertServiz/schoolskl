import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { rupeesToMinor, minorToInput } from '@/lib/money';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Fee setup', robots: { index: false, follow: false } };
const here = '/portal/fees/setup';
const uuid = z.string().uuid();

// Plain table writes: RLS (fees.structure.edit) is the gate, and DB triggers enforce the fee-increase cap and audit every change.
async function addHead(form: FormData) {
  'use server';
  const r = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/), name: z.string().trim().min(2).max(80), account: z.string().regex(/^[0-9]{5}$/), freq: z.enum(['monthly', 'annual', 'one_off']) })
    .safeParse({ code: form.get('code'), name: form.get('name'), account: form.get('account'), freq: form.get('freq') });
  if (!r.success) return fail(here, { message: r.error.issues.map((i) => i.path.join('.')).join(', ') });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('fee_heads').insert({ tenant_id: me.tenant.id, code: r.data.code, name: r.data.name, income_account_code: r.data.account, frequency: r.data.freq });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function updateHead(form: FormData) {
  'use server';
  const id = uuid.parse(form.get('id'));
  const sb = await supabaseServer();
  if (form.get('op') === 'delete') {
    const { error } = await sb.from('fee_heads').delete().eq('id', id);
    if (error) return fail(here, { message: error.code === '23503' ? 'This fee head is already used by a structure or a voucher — switch it off instead.' : error.message });
  } else {
    const { error } = await sb.from('fee_heads').update({ name: String(form.get('name') ?? '').trim(), is_active: form.get('active') === 'on' }).eq('id', id);
    if (error) return fail(here, error);
  }
  revalidatePath(here);
  done(here, 'OK');
}

async function deleteStructure(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.from('fee_structures').delete().eq('id', uuid.parse(form.get('structure')));
  if (error) return fail(here, { message: error.code === '23503' ? 'This structure was used for vouchers and cannot be deleted. Edit the amounts instead.' : error.message });
  revalidatePath(here);
  done(here, 'OK');
}

async function createStructure(form: FormData) {
  'use server';
  const r = z.object({ session: uuid, cls: uuid, name: z.string().trim().min(2).max(80) }).safeParse({ session: form.get('session'), cls: form.get('class'), name: form.get('name') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('fee_structures').insert({ tenant_id: me.tenant.id, session_id: r.data.session, class_id: r.data.cls, name: r.data.name });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

/** Fields are named a_<headId>; empty = remove the line, a number = set the amount. */
async function saveAmounts(form: FormData) {
  'use server';
  const structure = uuid.parse(form.get('structure'));
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  for (const [k, v] of form.entries()) {
    if (!k.startsWith('a_') || typeof v !== 'string') continue;
    const head = uuid.safeParse(k.slice(2));
    if (!head.success) continue;
    if (v.trim() === '') { await sb.from('fee_structure_lines').delete().eq('structure_id', structure).eq('fee_head_id', head.data); continue; }
    const minor = rupeesToMinor(v);
    if (minor == null) return fail(here, { message: `${v}: ?` });
    const { error } = await sb.from('fee_structure_lines').upsert({ tenant_id: me.tenant.id, structure_id: structure, fee_head_id: head.data, amount_minor: minor }, { onConflict: 'structure_id,fee_head_id' });
    if (error) return fail(here, error); // includes the "fee increase above the school's cap" refusal
  }
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function saveFine(form: FormData) {
  'use server';
  const grace = z.coerce.number().int().min(0).max(90).safeParse(form.get('grace'));
  const fine = rupeesToMinor(String(form.get('fine') ?? ''));
  if (!grace.success || fine == null) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { data: me } = await sb.rpc('my_access');
  const { error } = await sb.from('fine_rules').upsert({ tenant_id: me.tenant.id, grace_days: grace.data, fine_minor: fine }, { onConflict: 'tenant_id' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

async function generate(form: FormData) {
  'use server';
  const r = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), session: uuid, cls: uuid.optional(), due: z.coerce.number().int().min(1).max(60) })
    .safeParse({ month: form.get('month'), session: form.get('session'), cls: String(form.get('class') ?? '') || undefined, due: form.get('due') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('generate_vouchers', { p_period: `${r.data.month}-01`, p_session: r.data.session, p_class: r.data.cls ?? null, p_due_days: r.data.due });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'finance.generated', { n: Number(data ?? 0) }));
}

export default async function FeeSetup({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'fees.structure.edit', 'fees.voucher.generate');
  const sp = await searchParams;
  const [{ data: heads }, { data: classes }, { data: structures }, { data: lines }, { data: session }, { data: fine }] = await Promise.all([
    p.sb.from('fee_heads').select('id, code, name, income_account_code, frequency, is_active').order('code'),
    p.sb.from('classes').select('id, name, level').order('level'),
    p.sb.from('fee_structures').select('id, session_id, class_id, name'),
    p.sb.from('fee_structure_lines').select('structure_id, fee_head_id, amount_minor'),
    p.sb.from('academic_sessions').select('id, name').eq('is_current', true).maybeSingle(),
    p.sb.from('fine_rules').select('grace_days, fine_minor').maybeSingle(),
  ]);
  const cls = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const amount = new Map((lines ?? []).map((l) => [`${l.structure_id}:${l.fee_head_id}`, Number(l.amount_minor)]));
  const edit = p.can('fees.structure.edit'), gen = p.can('fees.voucher.generate');
  const month = new Date().toISOString().slice(0, 7);
  const structured = new Set((structures ?? []).map((s) => s.class_id));

  return (
    <>
      <h1>{p.tr('finance.setup.title')}</h1>
      <Flash sp={sp} />

      <h2>{p.tr('finance.setup.heads')}</h2>
      {(heads ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid"><thead><tr><th>{p.tr('finance.setup.code')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('finance.setup.account')}</th><th>{p.tr('finance.setup.freq')}</th></tr></thead>
          <tbody>{(heads ?? []).map((h) => <tr key={h.id} style={h.is_active ? undefined : { opacity: 0.55 }}><td className="ltr">{h.code}</td><td>{edit ? <form action={updateHead} className="inline"><input type="hidden" name="id" value={h.id} /><input name="name" defaultValue={h.name} required minLength={2} /><label className="inline"><input type="checkbox" name="active" defaultChecked={h.is_active} /> {p.l('Active', 'فعال')}</label><button className="btn secondary small">{p.l('Save', 'محفوظ')}</button><button name="op" value="delete" formNoValidate className="btn secondary small">{p.l('Delete', 'حذف')}</button></form> : h.name}</td><td className="ltr">{h.income_account_code}</td><td>{p.tr(`finance.setup.frequency.${h.frequency}`)}</td></tr>)}</tbody></table></div>
      )}
      {edit ? (
        <form action={addHead} className="form card" style={{ marginTop: '1rem' }}>
          <label>{p.tr('finance.setup.code')}<input name="code" required pattern="[A-Za-z0-9_]{2,20}" className="ltr" placeholder="TUITION" /></label>
          <label>{p.tr('ui.name')}<input name="name" required minLength={2} maxLength={80} /></label>
          <label>{p.tr('finance.setup.account')}<input name="account" required pattern="[0-9]{5}" defaultValue="40100" className="ltr" /></label>
          <label>{p.tr('finance.setup.freq')}<select name="freq"><option value="monthly">{p.tr('finance.setup.frequency.monthly')}</option><option value="annual">{p.tr('finance.setup.frequency.annual')}</option><option value="one_off">{p.tr('finance.setup.frequency.one_off')}</option></select></label>
          <button className="btn">{p.tr('common.save')}</button>
        </form>
      ) : null}

      <h2>{p.tr('finance.setup.structures')}</h2>
      {(structures ?? []).map((s) => (
        <form key={s.id} action={saveAmounts} className="card" style={{ marginBottom: '1rem' }}>
          <input type="hidden" name="structure" value={s.id} />
          <h3 style={{ marginTop: 0 }}>{cls.get(s.class_id)} <span className="muted">{s.name}</span></h3>
          <div className="table-scroll"><table className="grid"><tbody>
            {(heads ?? []).filter((h) => h.is_active).map((h) => {
              const a = amount.get(`${s.id}:${h.id}`);
              return <tr key={h.id}><td>{h.name}</td><td><input name={`a_${h.id}`} defaultValue={a != null ? (a % 100 === 0 ? String(a / 100) : (a / 100).toFixed(2)) : ''} inputMode="decimal" className="ltr" size={10} disabled={!edit} aria-label={h.name} /></td></tr>;
            })}
          </tbody></table></div>
          {edit ? <p className="inline"><button className="btn small">{p.tr('common.save')}</button><button formAction={deleteStructure} formNoValidate className="btn secondary small">{p.l('Delete structure', 'اسٹرکچر حذف')}</button></p> : null}
        </form>
      ))}
      {edit && session ? (
        <form action={createStructure} className="form card">
          <input type="hidden" name="session" value={session.id} />
          <label>{p.tr('students.class')}<select name="class" required>{(classes ?? []).filter((c) => !structured.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{p.tr('ui.name')}<input name="name" required minLength={2} maxLength={80} defaultValue={session.name} /></label>
          <button className="btn">{p.tr('finance.setup.createStructure')}</button>
        </form>
      ) : null}

      <h2>{p.tr('finance.setup.finePolicy')}</h2>
      <form action={saveFine} className="form card">
        <label>{p.tr('finance.setup.graceDays')}<input name="grace" type="number" min={0} max={90} defaultValue={fine?.grace_days ?? 5} className="ltr" disabled={!edit} /></label>
        <label>{p.tr('finance.setup.fineAmount')}<input name="fine" inputMode="decimal" defaultValue={minorToInput(fine?.fine_minor)} className="ltr" disabled={!edit} /></label>
        {edit ? <button className="btn">{p.tr('common.save')}</button> : null}
      </form>

      {gen && session ? (
        <>
          <h2>{p.tr('finance.setup.generate')}</h2>
          <form action={generate} className="form card">
            <input type="hidden" name="session" value={session.id} />
            <label>{p.tr('payroll.period')}<input type="month" name="month" defaultValue={month} required className="ltr" /></label>
            <label>{p.tr('students.class')}<select name="class"><option value="">{p.tr('finance.setup.allClasses')}</option>{(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>{p.tr('finance.setup.dueDays')}<input name="due" type="number" min={1} max={60} defaultValue={10} className="ltr" /></label>
            <p className="muted">{p.tr('finance.setup.generateNote')}</p>
            <button className="btn">{p.tr('finance.setup.generate')}</button>
          </form>
        </>
      ) : null}
    </>
  );
}
