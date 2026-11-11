import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Reviews · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/reviews';
const go = (kind: 'ok' | 'err', msg: string): never => redirect(`${here}?${kind}=${encodeURIComponent(msg)}`);
const publish = () => { revalidateTag('site-reviews'); revalidatePath('/m/[lang]', 'layout'); };

async function superOnly() { const { role } = await requireVendor(); if (role !== 'vendor_super_admin') go('err', 'Only the super admin can change reviews'); }

async function setStatus(form: FormData) {
  'use server';
  await superOnly();
  const { error } = await (await supabaseServer()).from('site_reviews').update({ status: z.enum(['approved', 'hidden', 'pending']).parse(form.get('to')) }).eq('id', z.string().uuid().parse(form.get('id')));
  if (error) return go('err', error.message);
  publish(); go('ok', 'Saved');
}
async function remove(form: FormData) {
  'use server';
  await superOnly();
  const { error } = await (await supabaseServer()).from('site_reviews').delete().eq('id', z.string().uuid().parse(form.get('id')));
  if (error) return go('err', error.message);
  publish(); go('ok', 'Deleted');
}
async function addAdmin(form: FormData) {
  'use server';
  await superOnly();
  const r = z.object({ name: z.string().trim().min(2).max(80), school: z.string().trim().max(120), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().min(5).max(600) })
    .safeParse({ name: form.get('name'), school: form.get('school') ?? '', rating: form.get('rating'), comment: form.get('comment') });
  if (!r.success) return go('err', 'Check the fields');
  const { error } = await (await supabaseServer()).from('site_reviews').insert({ name: r.data.name, school_name: r.data.school || null, rating: r.data.rating, comment: r.data.comment, status: 'approved', source: 'admin' });
  if (error) return go('err', error.message);
  publish(); go('ok', 'Added');
}

export default async function Reviews({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { role } = await requireVendor();
  const sp = await searchParams;
  const { data } = await (await supabaseServer()).from('site_reviews').select('id, name, school_name, rating, comment, status, source, created_at').order('created_at', { ascending: false }).limit(200);
  const list = data ?? [];
  const shown = list.filter((r) => r.status === 'approved');
  const avg = shown.length ? shown.reduce((a, r) => a + r.rating, 0) / shown.length : 0;
  const sup = role === 'vendor_super_admin';
  return (
    <div className="wrap">
      <h1>Customer reviews</h1>
      <Flash sp={sp} />
      <p className="muted">Visitors can leave a rating on the website; nothing appears publicly until you approve it. Approved average: <strong className="ltr">{avg ? avg.toFixed(1) : '—'} ★</strong> ({shown.length} shown, {list.filter((r) => r.status === 'pending').length} waiting)</p>
      <div className="table-scroll"><table className="grid">
        <thead><tr><th>Who</th><th>★</th><th>Comment</th><th>Status</th>{sup ? <th /> : null}</tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id}>
            <td>{r.name}<br /><span className="muted">{r.school_name}</span></td><td className="ltr">{'★'.repeat(r.rating)}</td><td>{r.comment}</td><td><span className="pill">{r.status}</span></td>
            {sup ? <td>
              <form action={setStatus} className="inline"><input type="hidden" name="id" value={r.id} />
                {r.status !== 'approved' ? <button name="to" value="approved" className="btn small">Approve</button> : null}
                {r.status !== 'hidden' ? <button name="to" value="hidden" className="btn secondary small">Hide</button> : null}
              </form>
              <form action={remove}><input type="hidden" name="id" value={r.id} /><button className="link">Delete</button></form>
            </td> : null}
          </tr>
        ))}</tbody>
      </table></div>
      {sup ? (
        <form action={addAdmin} className="form card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Add a review you collected yourself</h2>
          <label>Name<input name="name" required minLength={2} maxLength={80} /></label>
          <label>School<input name="school" maxLength={120} /></label>
          <label>Rating<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Comment<textarea name="comment" required minLength={5} maxLength={600} rows={3} /></label>
          <button className="btn">Add (shown immediately)</button>
        </form>
      ) : null}
    </div>
  );
}
