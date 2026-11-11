import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { done, fail, getLocale } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { t } from '@ilmora/i18n';

export const metadata = { title: 'Demo requests · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/leads';

async function handled(form: FormData) {
  'use server';
  const { user } = await requireVendor();
  const id = z.string().uuid().parse(form.get('id'));
  const sb = await supabaseServer();
  const { error } = await sb.from('demo_requests').update({ handled_at: new Date().toISOString(), handled_by: user.id }).eq('id', id);
  if (error) return fail(here, error);
  revalidatePath(here);
  done(here, t(await getLocale(), 'ui.ok'));
}

export default async function Leads({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await getLocale();
  const tr = (k: string) => t(locale, k);
  await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data } = await sb.from('demo_requests').select('id, full_name, school_name, city, phone, email, students_band, message, created_at, handled_at').order('created_at', { ascending: false }).limit(200);
  return (
    <div className="wrap">
      <h1>{tr('vendor.leads')}</h1>
      <Flash sp={sp} />
      {(data ?? []).length === 0 ? <p className="muted">{tr('ui.empty')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{tr('ui.name')}</th><th>{tr('marketing.demo.school')}</th><th>{tr('ui.phone')}</th><th>{tr('ui.date')}</th><th /></tr></thead>
          <tbody>{(data ?? []).map((l) => (
            <tr key={l.id}>
              <td>{l.full_name}{l.message ? <><br /><span className="muted">{l.message}</span></> : null}</td>
              <td>{l.school_name}<br /><span className="muted">{l.city}</span></td>
              <td className="ltr">{l.phone}{l.email ? <><br />{l.email}</> : null}</td>
              <td className="ltr">{String(l.created_at).slice(0, 10)}</td>
              <td>{l.handled_at ? <span className="pill">{tr('vendor.handled')}</span> : (
                <form action={handled}><input type="hidden" name="id" value={l.id} /><button className="btn secondary small">{tr('vendor.markHandled')}</button></form>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
