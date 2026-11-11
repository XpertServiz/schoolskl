import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PrintButton } from '@/components/print-button';
import { requireVendor } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { formatRupees, money } from '@ilmora/core';

export const metadata = { title: 'Document · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const fmt = (n: number | string) => formatRupees(money(BigInt(Math.trunc(Number(n))), 'PKR'), 'en-PK');

/** Printable quotation / invoice. The brand name comes from the same env variable as the rest of the site. */
export default async function Doc({ params }: { params: Promise<{ id: string }> }) {
  await requireVendor();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sb = await supabaseServer();
  const [{ data: d }, { data: lines }, { data: pays }] = await Promise.all([
    sb.from('platform_documents').select('*').eq('id', id).maybeSingle(),
    sb.from('platform_document_lines').select('description, qty, unit_minor').eq('doc_id', id).order('sort_order'),
    sb.from('platform_payments').select('amount_minor, paid_on, method').eq('doc_id', id).order('paid_on'),
  ]);
  if (!d) notFound();
  const total = (lines ?? []).reduce((a, l) => a + Number(l.qty) * Number(l.unit_minor), 0);
  const paid = (pays ?? []).reduce((a, p) => a + Number(p.amount_minor), 0);
  const brand = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Ilmified';
  return (
    <div className="wrap" style={{ maxWidth: 800 }}>
      <p className="no-print inline"><Link href="/vendor/billing">← Back</Link> <PrintButton label="Print / save as PDF" /></p>
      <h1 style={{ marginBottom: 0 }}>{d.kind === 'quote' ? 'Quotation' : 'Invoice'} <span className="ltr">{d.number}</span></h1>
      <p className="muted">{brand} · Issued <span className="ltr">{d.issue_date}</span>{d.due_date ? <> · {d.kind === 'quote' ? 'Valid until' : 'Due'} <span className="ltr">{d.due_date}</span></> : null} · <span className="pill">{d.status}</span></p>
      <p><strong>{d.customer_name}</strong><br />{d.customer_email}<br />{d.customer_phone}</p>
      <table className="grid"><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
        <tbody>{(lines ?? []).map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{Number(l.qty)}</td><td className="num">{fmt(l.unit_minor)}</td><td className="num">{fmt(Number(l.qty) * Number(l.unit_minor))}</td></tr>)}
          <tr><th colSpan={3}>Total</th><th className="num">{fmt(total)}</th></tr>
          {d.kind === 'invoice' ? <><tr><td colSpan={3}>Paid</td><td className="num">{fmt(paid)}</td></tr><tr><th colSpan={3}>Balance due</th><th className="num">{fmt(total - paid)}</th></tr></> : null}
        </tbody></table>
      {d.notes ? <p className="muted">{d.notes}</p> : null}
      {(pays ?? []).length ? <><h3>Payments</h3><ul>{(pays ?? []).map((p, i) => <li key={i} className="ltr">{p.paid_on} — {fmt(p.amount_minor)} {p.method ?? ''}</li>)}</ul></> : null}
    </div>
  );
}
