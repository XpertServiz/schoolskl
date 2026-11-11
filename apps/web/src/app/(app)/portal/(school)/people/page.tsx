import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { t } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { findOrCreateLogin } from '@/lib/invite';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'People and logins', robots: { index: false, follow: false } };
const here = '/portal/people';
const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (String(v ?? '').trim() || null);

const ERR: Record<string, string> = { self: 'people.err.self', owner: 'people.err.owner', escalation: 'people.err.escalation', guardian_linked: 'people.err.linked', staff_linked: 'people.err.linked', role: 'people.err.role' };
const errKey = (e: { message: string; hint?: string | null }) => ERR[e.hint ?? ''] ?? null;

async function invite(form: FormData) {
  'use server';
  const loc = await getLocale();
  const r = z.object({ email: z.string().email().max(200), name: z.string().min(2).max(120), role: z.string().regex(/^[a-z_]{2,40}$/), guardian: uuid.nullable(), staff: uuid.nullable() })
    .safeParse({ email: opt(form.get('email'))?.toLowerCase(), name: opt(form.get('name')), role: opt(form.get('role')), guardian: opt(form.get('guardian')), staff: opt(form.get('staff')) });
  if (!r.success) return fail(here, { message: t(loc, 'people.err.fields') });
  const sb = await supabaseServer();
  // the caller's own permission first — only then may the service role touch Auth
  const { data: me } = await sb.rpc('my_access');
  if (!me?.permissions?.includes('users.manage')) return fail(here, { message: t(loc, 'people.err.mfa') });
  let login: { id: string; created: boolean };
  try { login = await findOrCreateLogin(r.data.email, r.data.name); } catch { return fail(here, { message: t(loc, 'people.err.login') }); }
  const { error } = await sb.rpc('invite_member', { p_user: login.id, p_full_name: r.data.name, p_role_key: r.data.role, p_guardian: r.data.guardian, p_staff: r.data.staff });
  if (error) { const k = errKey(error); return fail(here, k ? { message: t(loc, k) } : error); }
  revalidatePath(here);
  done(here, t(loc, 'people.invited', { email: r.data.email }));
}

async function setStatus(form: FormData) {
  'use server';
  const loc = await getLocale();
  const r = z.object({ user: uuid, status: z.enum(['active', 'suspended', 'left']) }).safeParse({ user: form.get('user'), status: form.get('status') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_member_status', { p_user: r.data.user, p_status: r.data.status });
  if (error) { const k = errKey(error); return fail(here, k ? { message: t(loc, k) } : error); }
  revalidatePath(here);
  done(here, t(loc, 'people.saved'));
}

async function removeRole(form: FormData) {
  'use server';
  const loc = await getLocale();
  const r = z.object({ user: uuid, role: z.string().regex(/^[a-z_]{2,40}$/) }).safeParse({ user: form.get('user'), role: form.get('role') });
  if (!r.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('remove_member_role', { p_user: r.data.user, p_role_key: r.data.role });
  if (error) { const k = errKey(error); return fail(here, k ? { message: t(loc, k) } : error); }
  revalidatePath(here);
  done(here, t(loc, 'people.saved'));
}

// The roles a school normally hands out, in the order people look for them. Others (vendor-ish, future modules) stay hidden from the picker.
const ROLE_ORDER = ['parent', 'teacher', 'class_teacher', 'coordinator', 'principal', 'campus_admin', 'accountant', 'cashier', 'admissions_officer',
  'exam_controller', 'hr_manager', 'transport_manager', 'driver', 'bus_attendant', 'it_admin', 'school_owner'];

type Member = { user_id: string; full_name: string | null; email: string; status: string; roles: string[]; guardian_of: string[]; staff_no: string | null; last_sign_in_at: string | null };

export default async function People({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  // users.manage needs 2FA: an owner without it is told how to get there instead of being bounced
  if (!p.can('users.manage')) {
    if (!p.mfaOff || !p.can('settings.manage')) need(p, 'users.manage'); // only school managers are told about 2FA; others are sent away
    return (<><h1>{p.tr('people.title')}</h1><p role="status" className="notice"><Link href="/portal/security">{p.tr('people.err.mfa')}</Link></p></>);
  }
  const [{ data: members }, { data: roles }, { data: guardians }, { data: staff }] = await Promise.all([
    p.sb.rpc('school_members'),
    p.sb.from('roles').select('key, name'),
    p.can('students.edit') ? p.sb.from('guardians').select('id, full_name, phone, user_id').is('user_id', null).order('full_name') : Promise.resolve({ data: [] }),
    p.can('payroll.prepare') ? p.sb.from('staff_members').select('id, employee_no, full_name, user_id').is('user_id', null).eq('status', 'active').order('full_name') : Promise.resolve({ data: [] }),
  ]);
  const roleName = (k: string) => p.tr(`people.roles.${k}`) || (roles ?? []).find((r) => r.key === k)?.name || k;
  const pickable = ROLE_ORDER.filter((k) => (roles ?? []).some((r) => r.key === k));
  const list = (members ?? []) as Member[];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  return (
    <>
      <h1>{p.tr('people.title')}</h1>
      <Flash sp={sp} />
      <p className="muted">{p.tr('people.intro')}</p>

      <section className="card">
        <h2>{p.tr('people.invite')}</h2>
        <form action={invite} className="stack">
          <label>{p.tr('people.email')} <input name="email" type="email" required maxLength={200} autoComplete="off" className="ltr" /></label>
          <label>{p.tr('people.name')} <input name="name" required minLength={2} maxLength={120} /></label>
          <label>{p.tr('people.role')}
            <select name="role" required defaultValue="parent">
              {pickable.map((k) => <option key={k} value={k}>{roleName(k)}</option>)}
            </select>
          </label>
          {(guardians ?? []).length ? (
            <label>{p.tr('people.linkGuardian')}
              <select name="guardian" defaultValue="">
                <option value="">{p.tr('transport.none')}</option>
                {(guardians ?? []).map((g) => <option key={g.id} value={g.id}>{g.full_name}{g.phone ? ` · ${g.phone}` : ''}</option>)}
              </select>
            </label>
          ) : null}
          {(staff ?? []).length ? (
            <label>{p.tr('people.linkStaff')}
              <select name="staff" defaultValue="">
                <option value="">{p.tr('transport.none')}</option>
                {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.employee_no})</option>)}
              </select>
            </label>
          ) : null}
          <p className="muted">{p.tr('people.linkHint')}</p>
          <button className="btn">{p.tr('people.inviteBtn')}</button>
        </form>
        <h3>{p.tr('people.tellThem')}</h3>
        <p className="muted">{p.tr('people.howToSignIn', { url: `${site}/portal/login` })}</p>
      </section>

      <h2>{p.tr('people.members')} ({list.length})</h2>
      <div className="table-scroll"><table className="grid">
        <thead><tr><th>{p.tr('people.name')}</th><th>{p.tr('people.email')}</th><th>{p.tr('people.role')}</th><th>{p.tr('people.linked')}</th><th>{p.tr('ui.status')}</th><th /></tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.user_id}>
            <td>{m.full_name ?? '—'}{m.user_id === p.user.id ? <> <span className="pill">{p.tr('people.you')}</span></> : null}</td>
            <td className="ltr">{m.email}</td>
            <td>{m.roles.map((k) => (
              <form key={k} action={removeRole} className="inline" style={{ display: 'inline-flex', marginInlineEnd: '.5rem' }}>
                <input type="hidden" name="user" value={m.user_id} /><input type="hidden" name="role" value={k} />
                <span className="pill">{roleName(k)}</span>
                {m.user_id !== p.user.id ? <button className="link" aria-label={`${p.tr('people.removeRole')} ${roleName(k)}`}>×</button> : null}
              </form>
            ))}</td>
            <td>{[...m.guardian_of, m.staff_no ? `${p.tr('nav.staff')} ${m.staff_no}` : ''].filter(Boolean).join(', ') || '—'}</td>
            <td>{p.tr(`people.status.${m.status}`)}{m.last_sign_in_at ? null : <div className="muted">{p.tr('people.neverSignedIn')}</div>}</td>
            <td>{m.user_id === p.user.id ? null : (
              <form action={setStatus} className="inline">
                <input type="hidden" name="user" value={m.user_id} />
                {m.status === 'active'
                  ? <><button className="link" name="status" value="suspended">{p.tr('people.suspend')}</button> <button className="link" name="status" value="left">{p.tr('people.removeAccess')}</button></>
                  : <button className="link" name="status" value="active">{p.tr('people.reactivate')}</button>}
              </form>
            )}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
