import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { minorToInput } from '@/lib/money';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Fees', robots: { index: false, follow: false } };
const here = '/portal/fees';

const paymentSchema = z.object({
  family: z.string().uuid(), voucher: z.string().uuid().optional(), key: z.string().min(8).max(80),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), channel: z.enum(['cash', 'bank']),
});

/** Rupees typed by a person → paisa. String maths only; never a float. */
const toMinor = (s: string) => { const [w, f = ''] = s.split('.'); return Number(w) * 100 + Number(f.padEnd(2, '0')); };

async function collect(form: FormData) {
  'use server';
  const locale = await getLocale();
  const parsed = paymentSchema.safeParse({ family: form.get('family'), voucher: form.get('voucher') || undefined, key: form.get('key'), amount: form.get('amount'), channel: form.get('channel') });
  if (!parsed.success) return fail(here, { message: parsed.error.issues[0]?.message ?? 'invalid payment' });
  const i = parsed.data;
  const sb = await supabaseServer();
  // The idempotency key is minted when the form is rendered, so a double-click or a retry after a timeout can never record the money twice.
  const { error } = await sb.rpc('record_payment', { p_family: i.family, p_amount: toMinor(i.amount), p_channel: i.channel, p_idempotency_key: i.key, p_voucher: i.voucher ?? null });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(locale, 'fees.recorded'));
}

async function openDrawer(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('open_cashier_session', { p_campus: z.string().uuid().parse(form.get('campus')) });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'fees.drawerOpened'));
}

interface Row { voucher_id: string; family_id: string; student_id: string; voucher_no: string; due_date: string; balance_minor: number; days_overdue: number; bucket: string }

export default async function Fees({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string; overdue?: string }> }) {
  const p = await portal();
  need(p, 'fees.view', 'fees.collect');
  const sp = await searchParams;

  let query = p.sb.from('v_fee_aging').select('voucher_id, family_id, student_id, voucher_no, due_date, balance_minor, days_overdue, bucket').gt('balance_minor', 0).order('due_date').limit(200);
  if (sp.overdue === '1') query = query.gt('days_overdue', 0);
  const { data: rows } = await query;
  const aging = (rows ?? []) as Row[];

  const ids = [...new Set(aging.map((r) => r.student_id))];
  const { data: studs } = ids.length ? await p.sb.from('students').select('id, full_name, admission_no').in('id', ids) : { data: [] };
  const byId = new Map((studs ?? []).map((s) => [s.id as string, s as { id: string; full_name: string; admission_no: string | null }]));
  const vouchers = aging.filter((r) => {
    const needle = (sp.q ?? '').trim().toLowerCase();
    if (!needle) return true;
    const s = byId.get(r.student_id);
    return r.voucher_no.toLowerCase().includes(needle) || (s?.full_name ?? '').toLowerCase().includes(needle);
  });

  const canCollect = p.can('fees.collect');
  const { data: sess } = canCollect ? await p.sb.from('cashier_sessions').select('id').eq('cashier_id', p.user.id).eq('status', 'open').limit(1) : { data: [] };
  const hasDrawer = (sess ?? []).length > 0;
  const { data: campuses } = canCollect && !hasDrawer ? await p.sb.from('campuses').select('id, name').eq('is_active', true) : { data: [] };

  return (
    <>
      <h1>{p.tr('fees.title')}</h1>
      <Flash sp={sp} />
      {canCollect && !hasDrawer ? (
        <form action={openDrawer} className="card inline" style={{ marginBottom: '1rem' }}>
          <span>{p.tr('fees.noSession')}</span>
          <select name="campus" aria-label={p.tr('ui.campus')}>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn small">{p.tr('fees.openSession')}</button>
        </form>
      ) : null}

      <form className="inline" style={{ marginBottom: '1rem' }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder={p.tr('fees.searchHint')} aria-label={p.tr('common.search')} />
        <label className="inline"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === '1'} /> {p.tr('cockpit.overdue')}</label>
        <button className="btn secondary small">{p.tr('common.search')}</button>
      </form>

      {vouchers.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : (
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>{p.tr('fees.voucher')}</th><th>{p.tr('fees.student')}</th><th>{p.tr('ui.due')}</th><th className="num">{p.tr('ui.balance')}</th>{canCollect ? <th>{p.tr('fees.collect')}</th> : null}</tr></thead>
            <tbody>
              {vouchers.map((r) => (
                <tr key={r.voucher_id}>
                  <td className="ltr"><Link href={`/portal/fees/voucher/${r.voucher_id}`}>{r.voucher_no}</Link></td>
                  <td>{byId.get(r.student_id)?.full_name ?? '—'}</td>
                  <td className="ltr">{r.due_date}{r.days_overdue > 0 ? <> · <span className="pill">{p.tr('fees.agingBucket')} {r.days_overdue}</span></> : null}</td>
                  <td className="num">{p.fmt(r.balance_minor)}</td>
                  {canCollect ? (
                    <td>
                      <form action={collect} className="inline">
                        <input type="hidden" name="family" value={r.family_id} />
                        <input type="hidden" name="voucher" value={r.voucher_id} />
                        <input type="hidden" name="key" value={randomUUID()} />
                        <input name="amount" inputMode="decimal" required pattern="\d{1,9}(\.\d{1,2})?" defaultValue={minorToInput(r.balance_minor)} aria-label={p.tr('ui.amount')} size={9} className="ltr" />
                        <select name="channel" aria-label={p.tr('fees.channel')}>
                          {hasDrawer ? <option value="cash">{p.tr('fees.cash')}</option> : null}
                          <option value="bank">{p.tr('fees.bank')}</option>
                        </select>
                        <button className="btn small">{p.tr('fees.record')}</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
