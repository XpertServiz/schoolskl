import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { t } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal, type Portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';
import { setupSteps, type Progress } from '@/lib/setup';

export const metadata = { title: 'Setup', robots: { index: false, follow: false } };
const here = '/portal/setup';
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// DECISION: the usual Pakistani school ladder. These are school DATA (class names the school can rename), not interface text.
const STANDARD_CLASSES: [string, number][] = [['Playgroup', -2], ['Nursery', -1], ['Prep', 0], ...Array.from({ length: 10 }, (_, i) => [`Class ${i + 1}`, i + 1] as [string, number])];

const ok = async () => { revalidatePath(here); done(here, t(await getLocale(), 'setup.saved')); };
const tenantId = async (sb: Awaited<ReturnType<typeof supabaseServer>>) => ((await sb.rpc('my_access')).data as { tenant: { id: string } }).tenant.id;
const issues = (e: z.ZodError) => ({ message: e.issues.map((i) => i.path.join('.')).join(', ') });

// All writes are plain table writes gated by RLS (settings.manage) and audited by the standard triggers; vendor-managed tenant columns
// (slug, plan, status, currency) are refused by a trigger, so this page only ever sends name, language and public branding.
async function saveProfile(form: FormData) {
  'use server';
  const s = (k: string, max: number) => String(form.get(k) ?? '').trim().slice(0, max);
  const r = z.object({ name: z.string().min(2).max(120), locale: z.enum(['en', 'ur']) }).safeParse({ name: s('name', 120), locale: form.get('locale') });
  if (!r.success) return fail(here, issues(r.error));
  const sb = await supabaseServer();
  const id = await tenantId(sb);
  const { data: cur } = await sb.from('tenants').select('branding').eq('id', id).single();
  const branding = { ...((cur?.branding as object) ?? {}), tagline: s('tagline', 160), about: s('about', 1500), phone: s('phone', 30), address: s('address', 200) };
  const { error } = await sb.from('tenants').update({ name: r.data.name, locale: r.data.locale, branding }).eq('id', id);
  if (error) return fail(here, error);
  await ok();
}

async function addCampus(form: FormData) {
  'use server';
  const r = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/), name: z.string().trim().min(2).max(80), city: z.string().trim().max(60) })
    .safeParse({ code: form.get('code'), name: form.get('name'), city: form.get('city') ?? '' });
  if (!r.success) return fail(here, issues(r.error));
  const sb = await supabaseServer();
  const { error } = await sb.from('campuses').insert({ tenant_id: await tenantId(sb), code: r.data.code, name: r.data.name, city: r.data.city || null });
  if (error) return fail(here, error);
  await ok();
}

async function addSession(form: FormData) {
  'use server';
  const r = z.object({ name: z.string().trim().min(2).max(40), starts: date, ends: date, current: z.boolean() })
    .safeParse({ name: form.get('name'), starts: form.get('starts'), ends: form.get('ends'), current: form.get('current') === 'on' });
  if (!r.success) return fail(here, issues(r.error));
  const sb = await supabaseServer();
  const { data, error } = await sb.from('academic_sessions').insert({ tenant_id: await tenantId(sb), name: r.data.name, starts_on: r.data.starts, ends_on: r.data.ends }).select('id').single();
  if (error) return fail(here, error);
  if (r.data.current) {
    const c = await sb.rpc('set_current_session', { p_session: data.id });
    if (c.error) return fail(here, c.error);
  }
  await ok();
}

async function makeCurrent(form: FormData) {
  'use server';
  const id = uuid.safeParse(form.get('id'));
  if (!id.success) return fail(here, { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_current_session', { p_session: id.data });
  if (error) return fail(here, error);
  await ok();
}

async function addClass(form: FormData) {
  'use server';
  const r = z.object({ campus: uuid, name: z.string().trim().min(1).max(40), level: z.coerce.number().int().min(-5).max(20), section: z.string().trim().max(10) })
    .safeParse({ campus: form.get('campus'), name: form.get('name'), level: form.get('level') || 0, section: form.get('section') ?? '' });
  if (!r.success) return fail(here, issues(r.error));
  const sb = await supabaseServer();
  const tid = await tenantId(sb);
  const { data, error } = await sb.from('classes').insert({ tenant_id: tid, campus_id: r.data.campus, name: r.data.name, level: r.data.level }).select('id').single();
  if (error) return fail(here, error);
  if (r.data.section) {
    const s = await sb.from('sections').insert({ tenant_id: tid, class_id: data.id, name: r.data.section });
    if (s.error) return fail(here, s.error);
  }
  await ok();
}

async function addSection(form: FormData) {
  'use server';
  const r = z.object({ cls: uuid, name: z.string().trim().min(1).max(10) }).safeParse({ cls: form.get('class'), name: form.get('name') });
  if (!r.success) return fail(here, issues(r.error));
  const sb = await supabaseServer();
  const { error } = await sb.from('sections').insert({ tenant_id: await tenantId(sb), class_id: r.data.cls, name: r.data.name });
  if (error) return fail(here, error);
  await ok();
}

async function addStandard(form: FormData) {
  'use server';
  const campus = uuid.safeParse(form.get('campus'));
  if (!campus.success) return fail(here, { message: 'campus' });
  const sb = await supabaseServer();
  const tid = await tenantId(sb);
  const { data: existing } = await sb.from('classes').select('name').eq('campus_id', campus.data);
  const have = new Set((existing ?? []).map((c) => String(c.name).toLowerCase()));
  const missing = STANDARD_CLASSES.filter(([n]) => !have.has(n.toLowerCase()));
  if (missing.length) {
    const { data: made, error } = await sb.from('classes').insert(missing.map(([name, level]) => ({ tenant_id: tid, campus_id: campus.data, name, level }))).select('id');
    if (error) return fail(here, error);
    const s = await sb.from('sections').insert((made ?? []).map((c) => ({ tenant_id: tid, class_id: c.id, name: 'A' })));
    if (s.error) return fail(here, s.error);
  }
  await ok();
}

function Step({ p, k, isDone, optional, children }: { p: Portal; k: string; isDone: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <details className="card setup-step" open={!isDone} id={k}>
      <summary>
        <span className={`pill ${isDone ? 'ok' : ''}`}>{isDone ? `✓ ${p.tr('setup.done')}` : optional ? p.tr('setup.optional') : p.tr('setup.todo')}</span>{' '}
        <strong>{p.tr(`setup.steps.${k}.title`)}</strong>
      </summary>
      <p className="muted">{p.tr(`setup.steps.${k}.hint`)}</p>
      {children}
    </details>
  );
}

export default async function Setup({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'settings.manage');
  const sp = await searchParams;
  const [{ data: progress }, { data: tenant }, { data: campuses }, { data: sessions }, { data: classes }, { data: sections }] = await Promise.all([
    p.sb.rpc('setup_progress'),
    p.sb.from('tenants').select('id, name, locale, branding').eq('id', p.access.tenant.id).single(),
    p.sb.from('campuses').select('id, code, name, city').eq('is_active', true).order('code'),
    p.sb.from('academic_sessions').select('id, name, starts_on, ends_on, is_current').order('starts_on', { ascending: false }),
    p.sb.from('classes').select('id, name, level, campus_id').order('level'),
    p.sb.from('sections').select('id, class_id, name').order('name'),
  ]);
  const pr = (progress ?? {}) as Progress;
  const steps = setupSteps(pr, !p.mfaOff);
  const isDone = (k: string) => steps.find((s) => s.key === k)?.done ?? false;
  const b = (tenant?.branding ?? {}) as Record<string, string>;
  const secs = (cid: string) => (sections ?? []).filter((s) => s.class_id === cid);
  const campusName = new Map((campuses ?? []).map((c) => [c.id, c.name]));
  const oneCampus = (campuses ?? []).length === 1 ? campuses![0]! : null;
  const campusField = oneCampus
    ? <input type="hidden" name="campus" value={oneCampus.id} />
    : <label>{p.tr('ui.campus')}<select name="campus" required>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;

  return (
    <>
      <h1>{p.tr('setup.title')}</h1>
      <Flash sp={sp} />
      <p>{p.tr('setup.intro')}</p>
      <p><strong>{p.tr('setup.progress', { done: steps.filter((s) => s.done).length, total: steps.length })}</strong></p>
      <progress max={steps.length} value={steps.filter((s) => s.done).length} style={{ width: '100%', maxWidth: '28rem' }} />

      <Step p={p} k="profile" isDone={isDone('profile')}>
        <form action={saveProfile} className="form">
          <label>{p.tr('setup.profile.name')}<input name="name" required minLength={2} maxLength={120} defaultValue={tenant?.name ?? ''} /></label>
          <label>{p.tr('setup.profile.tagline')}<input name="tagline" maxLength={160} defaultValue={b.tagline ?? ''} /></label>
          <label>{p.tr('setup.profile.about')}<textarea name="about" rows={4} maxLength={1500} defaultValue={b.about ?? ''} /></label>
          <label>{p.tr('setup.profile.phone')}<input name="phone" maxLength={30} inputMode="tel" className="ltr" defaultValue={b.phone ?? ''} /></label>
          <label>{p.tr('setup.profile.address')}<input name="address" maxLength={200} defaultValue={b.address ?? ''} /></label>
          <label>{p.tr('setup.profile.language')}
            <select name="locale" defaultValue={tenant?.locale ?? 'en'}><option value="en">English</option><option value="ur" lang="ur">اردو</option></select>
          </label>
          <button className="btn">{p.tr('common.save')}</button>
        </form>
      </Step>

      <Step p={p} k="campuses" isDone={isDone('campuses')}>
        <p>{(campuses ?? []).map((c) => <span key={c.id} className="pill" style={{ marginInlineEnd: '.4rem' }}>{c.code} · {c.name}{c.city ? ` · ${c.city}` : ''}</span>)}</p>
        <form action={addCampus} className="inline">
          <input name="code" required maxLength={12} placeholder={p.tr('setup.campus.code')} aria-label={p.tr('setup.campus.code')} className="ltr" />
          <input name="name" required minLength={2} maxLength={80} placeholder={p.tr('ui.name')} aria-label={p.tr('ui.name')} />
          <input name="city" maxLength={60} placeholder={p.tr('setup.campus.city')} aria-label={p.tr('setup.campus.city')} />
          <button className="btn secondary small">{p.tr('setup.campus.add')}</button>
        </form>
      </Step>

      <Step p={p} k="session" isDone={isDone('session')}>
        {(sessions ?? []).length ? (
          <div className="table-scroll"><table className="grid">
            <thead><tr><th>{p.tr('setup.session.name')}</th><th>{p.tr('setup.session.starts')}</th><th>{p.tr('setup.session.ends')}</th><th /></tr></thead>
            <tbody>{(sessions ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td className="ltr">{s.starts_on}</td><td className="ltr">{s.ends_on}</td>
                <td>{s.is_current ? <span className="pill ok">{p.tr('setup.session.current')}</span> : (
                  <form action={makeCurrent}><input type="hidden" name="id" value={s.id} /><button className="btn secondary small">{p.tr('setup.session.makeCurrent')}</button></form>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : null}
        <form action={addSession} className="form">
          <label>{p.tr('setup.session.name')}<input name="name" required maxLength={40} placeholder="2026-27" className="ltr" /></label>
          <label>{p.tr('setup.session.starts')}<input name="starts" type="date" required className="ltr" /></label>
          <label>{p.tr('setup.session.ends')}<input name="ends" type="date" required className="ltr" /></label>
          <label className="inline"><input name="current" type="checkbox" defaultChecked={!pr.session} /> {p.tr('setup.session.makeCurrent')}</label>
          <button className="btn">{p.tr('setup.session.add')}</button>
        </form>
      </Step>

      <Step p={p} k="classes" isDone={isDone('classes')}>
        {(classes ?? []).length === 0 ? <p className="muted">{p.tr('setup.classes.none')}</p> : (
          <div className="table-scroll"><table className="grid">
            <thead><tr><th>{p.tr('setup.classes.name')}</th>{oneCampus ? null : <th>{p.tr('ui.campus')}</th>}<th>{p.tr('setup.classes.sections')}</th><th>{p.tr('setup.classes.addSection')}</th></tr></thead>
            <tbody>{(classes ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {oneCampus ? null : <td>{campusName.get(c.campus_id) ?? '—'}</td>}
                <td>{secs(c.id).map((s) => <span key={s.id} className="pill" style={{ marginInlineEnd: '.3rem' }}>{s.name}</span>)}</td>
                <td>
                  <form action={addSection} className="inline">
                    <input type="hidden" name="class" value={c.id} />
                    <input name="name" required maxLength={10} size={4} aria-label={p.tr('setup.classes.addSection')} placeholder="B" />
                    <button className="btn secondary small">+</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <form action={addStandard} className="inline" style={{ margin: '.75rem 0' }}>
          {campusField}
          <button className="btn secondary">{p.tr('setup.classes.standard')}</button>
          <span className="muted" style={{ fontSize: '.9rem' }}>{p.tr('setup.classes.standardHint')}</span>
        </form>
        <form action={addClass} className="form">
          {campusField}
          <label>{p.tr('setup.classes.name')}<input name="name" required maxLength={40} placeholder="Class 6" /></label>
          <label>{p.tr('setup.classes.level')}<input name="level" type="number" min={-5} max={20} defaultValue={(classes ?? []).length + 1} className="ltr" /></label>
          <label>{p.tr('setup.classes.sections')}<input name="section" maxLength={10} defaultValue="A" /></label>
          <button className="btn">{p.tr('setup.classes.addClass')}</button>
        </form>
      </Step>

      <Step p={p} k="fees" isDone={isDone('fees')}><p><Link className="btn secondary small" href="/portal/fees/setup">{p.tr('setup.open')}</Link></p></Step>
      <Step p={p} k="students" isDone={isDone('students')}>
        <p className="inline"><Link className="btn secondary small" href="/portal/students">{p.tr('setup.open')}</Link> <Link className="btn secondary small" href="/portal/students/import">{p.tr('import.open')}</Link></p>
      </Step>
      <Step p={p} k="staff" isDone={isDone('staff')}><p><Link className="btn secondary small" href="/portal/staff">{p.tr('setup.open')}</Link></p></Step>
      <Step p={p} k="timetable" isDone={pr.timetable > 0} optional><p><Link className="btn secondary small" href="/portal/timetable">{p.tr('setup.open')}</Link></p></Step>
      <Step p={p} k="security" isDone={isDone('security')}><p><Link className="btn secondary small" href="/portal/security">{p.tr('setup.open')}</Link></p></Step>
    </>
  );
}
