import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Bars } from '@/components/charts';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { rupeesToMinor } from '@/lib/money';
import { supabaseServer } from '@/lib/supabase/server';
import { formatRupees, money } from '@ilmora/core';

export const metadata = { title: 'Quotes & invoices · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/billing';
const go = (kind: 'ok' | 'err', msg: string): never => redirect(`${here}?${kind}=${encodeURIComponent(msg)}`);
const fmt = (n: number | string) => formatRupees(money(BigInt(Math.trunc(Number(n))), 'PKR'), 'en-PK');
async function superOnly() { const { role } = await requireVendor(); if (role !== 'vendor_super_admin') go('err', 'Only the super admin can change billing'); }

/** Quotation or invoice with up to five lines. Numbers (QT-2026-0001 / INV-…) come from the database so they never repeat. */
async function create(form: FormData) {
  'use server';
  await superOnly();
  const kind = z.enum(['quote', 'invoice']).parse(form.get('kind'));
  const r = z.object({ customer: z.string().trim().min(2).max(160), email: z.string().trim().max(160), phone: z.string().trim().max(40), school: z.string().uuid().optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(1000) })
    .safeParse({ customer: form.get('customer'), email: form.get('email') ?? '', phone: form.get('phone') ?? '', school: String(form.get('school') ?? '') || undefined, due: String(form.get('due') ?? '') || undefined, notes: String(form.get('notes') ?? '') });
  if (!r.success) return go('err', 'Check the customer details');
  const lines: { description: string; qty: number; unit_minor: number; sort_order: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = String(form.get(`d${i}`) ?? '').trim();
    if (!d) continue;
    const unit = rupeesToMinor(String(form.get(`u${i}`) ?? ''));
    const qty = Number(form.get(`q${i}`) || 1);
    if (unit == null || !(qty > 0)) return go('err', `Line ${i + 1}: check qty and price`);
    lines.push({ description: d.slice(0, 200), qty, unit_minor: unit, sort_order: i });
  }
  if (!lines.length) return go('err', 'Add at least one line');
  const sb = await supabaseServer();
  const num = await sb.rpc('platform_next_number', { p_kind: kind });
  if (num.error) return go('err', num.error.message);
  const doc = await sb.from('platform_documents').insert({ kind, number: num.data, school_id: r.data.school ?? null, customer_name: r.data.customer, customer_email: r.data.email || null, customer_phone: r.data.phone || null, due_date: r.data.due ?? null, notes: r.data.notes || null }).select('id').single();
  if (doc.error) return go('err', doc.error.message);
  const ins = await sb.from('platform_document_lines').insert(lines.map((l) => ({ ...l, doc_id: doc.data.id })));
  if (ins.error) return go('err', ins.error.message);
  revalidatePath(here);
  redirect(`${here}/${doc.data.id}`);
}

async function setStatus(form: FormData) {
  'use server';
  await superOnly();
  const { error } = await (await supabaseServer()).from('platform_documents').update({ status: z.enum(['draft', 'sent', 'accepted', 'declined', 'paid', 'void']).parse(form.get('to')) }).eq('id', z.string().uuid().parse(form.get('id')));
  if (error) return go('err', error.message);
  revalidatePath(here); go('ok', 'Saved');
}

async function pay(form: FormData) {
  'use server';
  await superOnly();
  const amt = rupeesToMinor(String(form.get('amount') ?? ''));
  if (!amt) return go('err', 'Amount?');
  const id = z.string().uuid().parse(form.get('id'));
  const sb = await supabaseServer();
  const { error } = await sb.from('platform_payments').insert({ doc_id: id, amount_minor: amt, method: String(form.get('method') ?? '').slice(0, 40) || null });
  if (error) return go('err', error.message);
  revalidatePath(here); go('ok', 'Payment recorded');
}

async function toInvoice(form: FormData) {
  'use server';
  await superOnly();
  const id = z.string().uuid().parse(form.get('id'));
  const sb = await supabaseServer();
  const [{ data: q }, { data: lines }, num] = await Promise.all([
    sb.from('platform_documents').select('school_id, customer_name, customer_email, customer_phone, notes').eq('id', id).single(),
    sb.from('platform_document_lines').select('description, qty, unit_minor, sort_order').eq('doc_id', id),
    sb.rpc('platform_next_number', { p_kind: 'invoice' }),
  ]);
  if (!q || num.error) return go('err', 'Could not convert');
  const doc = await sb.from('platform_documents').insert({ ...q, kind: 'invoice', number: num.data, status: 'draft' }).select('id').single();
  if (doc.error) return go('err', doc.error.message);
  await sb.from('platform_document_lines').insert((lines ?? []).map((l) => ({ ...l, doc_id: doc.data.id })));
  await sb.from('platform_documents').update({ status: 'accepted' }).eq('id', id);
  revalidatePath(here);
  redirect(`${here}/${doc.data.id}`);
}

export default async function Billing({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { role } = await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: docs }, { data: lines }, { data: pays }, { data: sum }, { data: schools }] = await Promise.all([
    sb.from('platform_documents').select('id, kind, number, customer_name, status, issue_date').order('created_at', { ascending: false }).limit(100),
    sb.from('platform_document_lines').select('doc_id, qty, unit_minor'),
    sb.from('platform_payments').select('doc_id, amount_minor'),
    sb.rpc('platform_billing_summary'),
    sb.from('tenants').select('id, name').order('name'),
  ]);
  const total = new Map<string, number>(), paid = new Map<string, number>();
  for (const l of lines ?? []) total.set(l.doc_id, (total.get(l.doc_id) ?? 0) + Number(l.qty) * Number(l.unit_minor));
  for (const x of pays ?? []) paid.set(x.doc_id, (paid.get(x.doc_id) ?? 0) + Number(x.amount_minor));
  const s = (sum ?? { invoiced: 0, collected: 0, open_quotes: 0, months: [] }) as { invoiced: number; collected: number; open_quotes: number; months: { month: string; invoiced: number; collected: number }[] };
  const sup = role === 'vendor_super_admin';
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="wrap">
      <h1>Quotations & invoices</h1>
      <Flash sp={sp} />
      <div className="stats">
        <div className="card stat"><span className="num">{fmt(s.invoiced)}</span><span className="label">Invoiced</span></div>
        <div className="card stat"><span className="num">{fmt(s.collected)}</span><span className="label">Collected</span></div>
        <div className="card stat"><span className="num">{fmt(Number(s.invoiced) - Number(s.collected))}</span><span className="label">Still owed</span></div>
        <div className="card stat"><span className="num">{s.open_quotes}</span><span className="label">Open quotes</span></div>
      </div>
      <section className="card"><h3 style={{ marginTop: 0 }}>Invoiced per month (last 12)</h3><Bars data={s.months.map((m) => ({ label: m.month, value: Number(m.invoiced) }))} fmt={fmt} title="Invoiced per month" /></section>
      <h2>Documents</h2>
      {(docs ?? []).length === 0 ? <p className="muted">None yet.</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th /></tr></thead>
          <tbody>{(docs ?? []).map((d) => (
            <tr key={d.id}>
              <td className="ltr"><Link href={`${here}/${d.id}`}>{d.number}</Link></td><td>{d.customer_name}</td><td className="ltr">{d.issue_date}</td>
              <td className="num">{fmt(total.get(d.id) ?? 0)}</td><td className="num">{d.kind === 'invoice' ? fmt(paid.get(d.id) ?? 0) : '—'}</td><td><span className="pill">{d.status}</span></td>
              <td>{sup ? (
                <div className="inline">
                  <form action={setStatus} className="inline"><input type="hidden" name="id" value={d.id} />
                    {d.kind === 'quote' ? <><button name="to" value="sent" className="btn secondary small">Sent</button><button name="to" value="declined" className="btn secondary small">Declined</button></> : <><button name="to" value="sent" className="btn secondary small">Sent</button><button name="to" value="void" className="btn secondary small">Void</button></>}
                  </form>
                  {d.kind === 'quote' && d.status !== 'declined' ? <form action={toInvoice}><input type="hidden" name="id" value={d.id} /><button className="btn small">→ Invoice</button></form> : null}
                  {d.kind === 'invoice' && d.status !== 'void' ? <form action={pay} className="inline"><input type="hidden" name="id" value={d.id} /><input name="amount" placeholder="Payment" inputMode="decimal" className="ltr" size={8} /><input name="method" placeholder="Bank / cash" size={8} /><button className="btn small">Record</button></form> : null}
                </div>
              ) : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {sup ? (
        <form action={create} className="form card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>New quotation / invoice</h2>
          <label>Type<select name="kind"><option value="quote">Quotation</option><option value="invoice">Invoice</option></select></label>
          <label>Customer / school name<input name="customer" required minLength={2} maxLength={160} /></label>
          <label>Linked school (optional)<select name="school" defaultValue=""><option value="">—</option>{(schools ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Email<input name="email" type="email" maxLength={160} className="ltr" /></label>
          <label>Phone<input name="phone" maxLength={40} className="ltr" /></label>
          <label>Due / valid until<input name="due" type="date" min={today} className="ltr" /></label>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="inline"><input name={`d${i}`} placeholder={`Line ${i + 1} description`} maxLength={200} style={{ flex: 2 }} /><input name={`q${i}`} placeholder="Qty" defaultValue="1" inputMode="decimal" className="ltr" size={4} /><input name={`u${i}`} placeholder="Unit price" inputMode="decimal" className="ltr" size={9} /></div>
          ))}
          <label>Notes<textarea name="notes" rows={2} maxLength={1000} /></label>
          <button className="btn">Create</button>
        </form>
      ) : null}
    </div>
  );
}
