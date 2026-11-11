import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Approvals', robots: { index: false, follow: false } };

const here = '/portal/approvals';
const uuid = z.string().uuid();

/** Every action just calls the RPC that owns the rule (maker-checker, MFA, permission): this page cannot approve anything the database would refuse. */
async function decide(form: FormData) {
  'use server';
  const kind = String(form.get('kind'));
  const id = uuid.parse(form.get('id'));
  const approve = form.get('decision') !== 'reject';
  const sb = await supabaseServer();
  const locale = await getLocale();
  let error: { message: string } | null = null;
  if (kind === 'concession') ({ error } = await sb.rpc('approve_concession', { p_id: id, p_approve: approve }));
  else if (kind === 'payroll') ({ error } = await sb.rpc('post_payroll', { p_run: id }));
  else if (kind === 'results') ({ error } = await sb.rpc('publish_results', { p_exam: id }));
  else return fail(here, { message: 'unknown approval kind' });
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(locale, 'ui.ok'));
}

interface Item { kind: string; ref_id: string; title: string; detail: string | null; amount_minor: number | null; requested_at: string; can_act: boolean; blocked_reason: string | null }

export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  const { data } = await p.sb.rpc('approvals_inbox');
  const items = (data ?? []) as Item[];
  return (
    <>
      <h1>{p.tr('approvals.title')}</h1>
      <Flash sp={sp} />
      {items.length === 0 ? <p className="muted">{p.tr('approvals.empty')}</p> : (
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>{p.tr('ui.name')}</th><th>{p.tr('ui.status')}</th><th className="num">{p.tr('ui.amount')}</th><th>{p.tr('ui.date')}</th><th>{p.tr('ui.actions')}</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.kind}-${i.ref_id}`}>
                  <td><strong>{i.title}</strong><br /><span className="muted">{i.detail}</span></td>
                  <td><span className="pill">{p.tr(`approvals.kind.${i.kind}`)}</span></td>
                  <td className="num">{i.amount_minor != null ? p.fmt(i.amount_minor) : ''}</td>
                  <td className="ltr">{i.requested_at.slice(0, 10)}</td>
                  <td>
                    {i.kind === 'bank_line' ? <a className="btn secondary small" href="/portal/fees">{p.tr('fees.title')}</a>
                      : i.can_act ? (
                        <form action={decide} className="inline">
                          <input type="hidden" name="kind" value={i.kind} />
                          <input type="hidden" name="id" value={i.ref_id} />
                          <button name="decision" value="approve" className="btn small">
                            {i.kind === 'payroll' ? p.tr('approvals.post') : i.kind === 'results' ? p.tr('approvals.publish') : p.tr('approvals.approve')}
                          </button>
                          {i.kind === 'concession' ? <button name="decision" value="reject" className="btn secondary small">{p.tr('approvals.reject')}</button> : null}
                        </form>
                      ) : <span className="muted">{i.blocked_reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
