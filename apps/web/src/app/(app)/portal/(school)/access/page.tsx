import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/flash';
import { done, fail, need, portal } from '@/lib/portal';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Staff & permissions', robots: { index: false, follow: false } };
const here = '/portal/access';

interface Overview {
  permissions: { key: string; module: string; mfa: boolean }[];
  roles: { key: string; name: string; keys: string[] }[];
  members: { user_id: string; name: string | null; email: string | null; status: string; roles: string[]; grants: string[]; denies: string[] }[];
}

const effective = (o: Overview, m: Overview['members'][number]) => {
  const base = new Set<string>();
  for (const rk of m.roles) for (const k of o.roles.find((r) => r.key === rk)?.keys ?? []) base.add(k);
  const eff = new Set(base);
  m.grants.forEach((k) => eff.add(k));
  m.denies.forEach((k) => eff.delete(k));
  return { base, eff };
};

/** Saves one person's screen: a ticked box that differs from their role becomes a grant, an unticked one a deny, a match removes the override. */
async function saveMember(form: FormData) {
  'use server';
  const uid = String(form.get('user') ?? '');
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('access_overview');
  if (error) return fail(`${here}?u=${uid}`, error);
  const o = data as Overview;
  const m = o.members.find((x) => x.user_id === uid);
  if (!m) return fail(here, { message: 'person?' });
  const { base, eff } = effective(o, m);
  const want = new Set(form.getAll('perm').map(String));
  for (const perm of o.permissions) {
    const now = eff.has(perm.key), will = want.has(perm.key);
    if (now === will) continue;
    const effect = will === base.has(perm.key) ? 'inherit' : will ? 'grant' : 'deny';
    const r = await sb.rpc('set_member_permission', { p_user: uid, p_key: perm.key, p_effect: effect });
    if (r.error) return fail(`${here}?u=${uid}`, { message: `${perm.key}: ${r.error.message}` });
  }
  revalidatePath(here);
  done(`${here}?u=${uid}`, 'OK');
}

async function saveRole(form: FormData) {
  'use server';
  const role = String(form.get('role') ?? '');
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('access_overview');
  if (error) return fail(`${here}?role=${role}`, error);
  const o = data as Overview;
  const cur = new Set(o.roles.find((r) => r.key === role)?.keys ?? []);
  const want = new Set(form.getAll('perm').map(String));
  for (const perm of o.permissions) {
    if (cur.has(perm.key) === want.has(perm.key)) continue;
    const r = await sb.rpc('set_role_permission', { p_role: role, p_key: perm.key, p_on: want.has(perm.key) });
    if (r.error) return fail(`${here}?role=${role}`, { message: `${perm.key}: ${r.error.message}` });
  }
  revalidatePath(here);
  done(`${here}?role=${role}`, 'OK');
}

async function setStatus(form: FormData) {
  'use server';
  const sb = await supabaseServer();
  const uid = String(form.get('user') ?? '');
  const { error } = await sb.rpc('set_member_status', { p_user: uid, p_status: String(form.get('status')) });
  if (error) return fail(`${here}?u=${uid}`, error);
  revalidatePath(here);
  done(`${here}?u=${uid}`, 'OK');
}

const MODULE_UR: Record<string, string> = {};
const nice = (k: string) => k.split('.').slice(1).join(' · ').replace(/_/g, ' ') || k;

export default async function Access({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; u?: string; role?: string }> }) {
  const p = await portal();
  need(p, 'settings.manage', 'users.manage');
  const sp = await searchParams;
  const { data, error } = await p.sb.rpc('access_overview');
  if (error) {
    if (error.code === '42501') redirect('/portal?err=' + encodeURIComponent(p.tr('ui.noAccess')));
    throw new Error(error.message);
  }
  const o = data as Overview;
  const staff = o.members.filter((m) => m.status !== 'removed');
  const sel = staff.find((m) => m.user_id === sp.u);
  const role = o.roles.find((r) => r.key === sp.role);
  const modules = [...new Set(o.permissions.map((x) => x.module))];
  const Grid = ({ on, mine }: { on: Set<string>; mine?: Set<string> }) => (
    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
      {modules.map((mod) => (
        <fieldset key={mod} className="card" style={{ margin: 0 }}>
          <legend style={{ textTransform: 'capitalize', fontWeight: 700 }}>{MODULE_UR[mod] ?? mod}</legend>
          {o.permissions.filter((x) => x.module === mod).map((x) => (
            <label key={x.key} className="inline" style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.15rem 0' }}>
              <input type="checkbox" name="perm" value={x.key} defaultChecked={on.has(x.key)} />
              <span>{nice(x.key)}{x.mfa ? ' 🔒' : ''}{mine && mine.has(x.key) !== on.has(x.key) ? ' ✱' : ''}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
  return (
    <>
      <h1>{p.l('Staff & permissions', 'اسٹاف اور اجازتیں')}</h1>
      <Flash sp={sp} />
      <p className="muted">{p.l('Choose what each person can see and do. Tick = allowed. 🔒 = also needs a 2-step sign-in. ✱ = differs from the role. Hiding a button is never the only protection: the database enforces the same rules.', 'ہر شخص کیا دیکھ اور کر سکتا ہے یہاں طے کریں۔ ٹک = اجازت۔ 🔒 = دو مرحلہ سائن اِن بھی ضروری۔ ✱ = رول سے مختلف۔ ڈیٹا بیس بھی یہی اصول نافذ کرتا ہے۔')}</p>
      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {staff.map((m) => (
          <Link key={m.user_id} href={`${here}?u=${m.user_id}`} className={`btn ${sel?.user_id === m.user_id ? '' : 'secondary'} small`}>
            {m.name || m.email} <span className="muted">· {m.roles.join(', ') || '—'}{m.status !== 'active' ? ` · ${m.status}` : ''}</span>
          </Link>
        ))}
      </div>
      {sel ? (() => {
        const { base, eff } = effective(o, sel);
        return (
          <section className="card">
            <h2 style={{ marginTop: 0 }}>{sel.name || sel.email} <span className="pill">{sel.roles.join(', ')}</span></h2>
            {sel.roles.includes('school_owner') ? <p className="muted">{p.l('The owner always has full access.', 'مالک کو ہمیشہ مکمل رسائی حاصل ہے۔')}</p> : <form action={saveMember} className="form">
              <input type="hidden" name="user" value={sel.user_id} />
              <Grid on={eff} mine={base} />
              <p><button className="btn">{p.l('Save permissions', 'اجازتیں محفوظ کریں')}</button></p>
            </form>}
            <form action={setStatus} className="inline">
              <input type="hidden" name="user" value={sel.user_id} />
              <input type="hidden" name="status" value={sel.status === 'active' ? 'suspended' : 'active'} />
              <button className="btn secondary small">{sel.status === 'active' ? p.l('Suspend login', 'لاگ اِن معطل') : p.l('Restore login', 'لاگ اِن بحال')}</button>
            </form>
          </section>
        );
      })() : (
        <p className="muted">{p.l('Pick a person above — for example the accountant — then tick only what they should see.', 'اوپر سے کوئی شخص منتخب کریں — مثلاً اکاؤنٹنٹ — پھر صرف وہی ٹک کریں جو وہ دیکھے۔')}</p>
      )}
      <h2>{p.l('Role defaults', 'رول کی ڈیفالٹ اجازتیں')}</h2>
      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {o.roles.map((r) => <Link key={r.key} href={`${here}?role=${r.key}#role`} className={`btn ${role?.key === r.key ? '' : 'secondary'} small`}>{r.name}</Link>)}
      </div>
      {role ? (
        <section className="card" id="role">
          <h3 style={{ marginTop: 0 }}>{role.name}</h3>
          <p className="muted">{p.l('Changes apply to everyone who has this role in your school.', 'تبدیلی آپ کے اسکول میں اس رول والے ہر شخص پر لاگو ہوگی۔')}</p>
          <form action={saveRole} className="form">
            <input type="hidden" name="role" value={role.key} />
            <Grid on={new Set(role.keys)} />
            <p><button className="btn">{p.l('Save role', 'رول محفوظ کریں')}</button></p>
          </form>
        </section>
      ) : null}
    </>
  );
}
