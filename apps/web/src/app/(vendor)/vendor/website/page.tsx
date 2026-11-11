import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { t, type Locale } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { requireVendor } from '@/lib/auth';
import { platformOf } from '@/lib/embed';
import { siteUrl } from '@/lib/seo';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Website · Vendor Console', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const here = '/vendor/website';
const loc = async (): Promise<Locale> => ((await cookies()).get('locale')?.value === 'ur' ? 'ur' : 'en');
const go = (kind: 'ok' | 'err', msg: string): never => redirect(`${here}?${kind}=${encodeURIComponent(msg)}`);
const publish = () => { revalidateTag('site-content'); revalidatePath('/m/[lang]', 'layout'); }; // the public pages pick the change up at once

/** Every write needs the SUPER admin (also enforced by the database policies); support staff can only look. */
async function superOnly() {
  const { role } = await requireVendor();
  if (role !== 'vendor_super_admin') go('err', t(await loc(), 'vx.web.superOnly'));
}

const mediaSchema = z.object({
  kind: z.enum(['demo', 'reel']), title_en: z.string().trim().min(1).max(120), title_ur: z.string().trim().max(120),
  url: z.string().trim().max(400).regex(/^https:\/\/[^\s<>"]{4,}$/), sort_order: z.coerce.number().int().min(0).max(9999),
});

async function addMedia(form: FormData) {
  'use server';
  await superOnly();
  const r = mediaSchema.safeParse({ kind: form.get('kind'), title_en: form.get('title_en'), title_ur: form.get('title_ur') ?? '', url: form.get('url'), sort_order: form.get('sort_order') || 100 });
  if (!r.success) return go('err', t(await loc(), 'vx.web.bad'));
  const { error } = await (await supabaseServer()).from('site_media').insert(r.data);
  if (error) return go('err', error.message);
  publish();
  go('ok', t(await loc(), 'vx.web.saved'));
}

async function setActive(form: FormData) {
  'use server';
  await superOnly();
  const id = z.string().uuid().parse(form.get('id'));
  const { error } = await (await supabaseServer()).from('site_media').update({ is_active: form.get('to') === '1' }).eq('id', id);
  if (error) return go('err', error.message);
  publish();
  go('ok', t(await loc(), 'vx.web.saved'));
}

async function removeMedia(form: FormData) {
  'use server';
  await superOnly();
  const id = z.string().uuid().parse(form.get('id'));
  const { error } = await (await supabaseServer()).from('site_media').delete().eq('id', id);
  if (error) return go('err', error.message);
  publish();
  go('ok', t(await loc(), 'vx.web.saved'));
}

const URL_KEYS = ['facebook', 'instagram', 'youtube', 'tiktok'] as const;
async function saveSettings(form: FormData) {
  'use server';
  await superOnly();
  const sb = await supabaseServer();
  const bad = t(await loc(), 'vx.web.bad');
  const entries: [string, string][] = [];
  for (const k of ['whatsapp', 'phone', 'email', ...URL_KEYS, 'announcement_en', 'announcement_ur', 'theme']) entries.push([k, String(form.get(k) ?? '').trim()]);
  for (const [k, v] of entries) {
    if (!v) continue;
    if ((URL_KEYS as readonly string[]).includes(k) && !/^https:\/\/[^\s<>"]{4,}$/.test(v)) return go('err', bad);
    if (k === 'whatsapp' && !/^\+?\d{10,15}$/.test(v.replace(/[\s-]/g, ''))) return go('err', bad);
    if (k === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) return go('err', bad);
    if (v.length > 300 || /[<>]/.test(v)) return go('err', bad);
  }
  for (const [k, v] of entries) {
    const value = k === 'whatsapp' ? v.replace(/\D/g, '') : v;
    const { error } = value ? await sb.from('site_settings').upsert({ key: k, value }) : await sb.from('site_settings').delete().eq('key', k);
    if (error) return go('err', error.message);
  }
  publish();
  go('ok', t(await loc(), 'vx.web.saved'));
}

type Media = { id: string; kind: 'demo' | 'reel'; title_en: string; title_ur: string; url: string; sort_order: number; is_active: boolean };

export default async function Website({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await loc();
  const tr = (k: string) => t(locale, k);
  const { role } = await requireVendor();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: media }, { data: set }] = await Promise.all([
    sb.from('site_media').select('id, kind, title_en, title_ur, url, sort_order, is_active').order('kind').order('sort_order'),
    sb.from('site_settings').select('key, value'),
  ]);
  const s = Object.fromEntries((set ?? []).map((r) => [r.key as string, r.value as string]));
  const canEdit = role === 'vendor_super_admin';
  const field = (k: string, label: string, type = 'text') => (
    <label key={k}>{label}<input name={k} type={type} defaultValue={s[k] ?? ''} maxLength={300} className={k === 'whatsapp' || k === 'phone' || k === 'email' || URL_KEYS.includes(k as never) ? 'ltr' : undefined} /></label>
  );
  return (
    <div className="wrap">
      <h1>{tr('vx.web.title')}</h1>
      <Flash sp={sp} />
      <p className="muted">{tr('vx.web.intro')} <a href={siteUrl()} target="_blank" rel="noopener noreferrer">{tr('vx.web.view')} ↗</a></p>
      {!canEdit ? <p role="status" className="notice">{tr('vx.web.superOnly')}</p> : null}

      <h2>{tr('vx.web.media')}</h2>
      <p className="muted">{tr('vx.web.mediaHint')}</p>
      {(media ?? []).length === 0 ? <p className="muted">{tr('vx.web.none')}</p> : (
        <div className="table-scroll"><table className="grid">
          <thead><tr><th>{tr('vx.web.kind')}</th><th>{tr('vx.web.titleEn')}</th><th>{tr('vx.web.url')}</th><th /></tr></thead>
          <tbody>{(media as Media[]).map((m) => {
            const p = platformOf(m.url);
            return (
              <tr key={m.id} style={m.is_active ? undefined : { opacity: 0.55 }}>
                <td>{m.kind === 'demo' ? '🎬' : '📱'} {m.kind === 'demo' ? tr('vx.web.demo').split(' (')[0] : tr('vx.web.reel').split(' (')[0]} <span className="muted">#{m.sort_order}</span>{m.is_active ? null : <> <span className="pill">{tr('vx.web.hidden')}</span></>}</td>
                <td>{m.title_en}{m.title_ur ? <div className="muted">{m.title_ur}</div> : null}</td>
                <td><a className="ltr" href={m.url} target="_blank" rel="noopener noreferrer">{m.url.length > 48 ? m.url.slice(0, 48) + '…' : m.url}</a><div className="muted">{p ? `▶ ${p} — ${tr('vx.web.embeds')}` : tr('vx.web.linkOnly')}</div></td>
                <td>{canEdit ? (
                  <span className="inline">
                    <form action={setActive}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="to" value={m.is_active ? '0' : '1'} /><button className="link">{m.is_active ? tr('vx.web.hide') : tr('vx.web.show')}</button></form>
                    <form action={removeMedia}><input type="hidden" name="id" value={m.id} /><button className="link">{tr('vx.web.delete')}</button></form>
                  </span>
                ) : null}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {canEdit ? (
        <form action={addMedia} className="form card stack">
          <h3 style={{ margin: 0 }}>{tr('vx.web.add')}</h3>
          <label>{tr('vx.web.kind')}<select name="kind" defaultValue="reel"><option value="demo">{tr('vx.web.demo')}</option><option value="reel">{tr('vx.web.reel')}</option></select></label>
          <label>{tr('vx.web.titleEn')}<input name="title_en" required maxLength={120} /></label>
          <label>{tr('vx.web.titleUr')}<input name="title_ur" maxLength={120} /></label>
          <label>{tr('vx.web.url')}<input name="url" type="url" required maxLength={400} className="ltr" placeholder="https://www.youtube.com/watch?v=…" /></label>
          <label>{tr('vx.web.order')}<input name="sort_order" type="number" min={0} max={9999} defaultValue={100} className="ltr" /></label>
          <button className="btn">{tr('vx.web.add')}</button>
        </form>
      ) : null}

      <h2>{tr('vx.web.settings')}</h2>
      {canEdit ? (
        <form action={saveSettings} className="form card stack">
          {field('whatsapp', tr('vx.web.whatsapp'))}{field('phone', tr('vx.web.phone'))}{field('email', tr('vx.web.email'), 'email')}
          {field('facebook', tr('vx.web.facebook'))}{field('instagram', tr('vx.web.instagram'))}{field('youtube', tr('vx.web.youtube'))}{field('tiktok', tr('vx.web.tiktok'))}
          {field('announcement_en', tr('vx.web.announceEn'))}{field('announcement_ur', tr('vx.web.announceUr'))}
          <label>Landing theme<select name="theme" defaultValue={s.theme ?? ""}><option value="">Default (saffron)</option><option value="saffron">Saffron</option><option value="teal">Teal</option><option value="violet">Violet</option><option value="rose">Rose</option></select></label>
          <p className="muted">{tr('vx.web.announceHint')}</p>
          <button className="btn">{tr('vx.web.save')}</button>
        </form>
      ) : <p className="muted">{Object.keys(s).length ? Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(' · ') : tr('vx.web.none')}</p>}
    </div>
  );
}
