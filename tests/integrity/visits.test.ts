import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';

/** Website visitor counts: server-only writes, closed list of pages, vendor-only reads, nothing personal stored. */
let db: PGlite;
let w: World;
beforeAll(async () => { db = await createDb(); w = await buildWorld(db); });

const visit = (path: string, lang: string, first: boolean) => q(db, null, `select public.record_visit($1,$2,$3)`, [path, lang, first], 'service_role');

describe('record_visit', () => {
  it('counts views for every page view and visits only for the first page of a session, per day, page and language', async () => {
    await visit('/', 'en', true); await visit('/pricing', 'en', false); await visit('/', 'en', true); await visit('/', 'ur', true);
    const r = (await admin<{ path: string; lang: string; visits: number; views: number }>(db, `select path, lang, visits, views from public.site_visits order by path, lang`)).rows;
    expect(r).toEqual([
      { path: '/', lang: 'en', visits: 2, views: 2 },
      { path: '/', lang: 'ur', visits: 1, views: 1 },
      { path: '/pricing', lang: 'en', visits: 0, views: 1 },
    ]);
  });

  it('ignores any page that is not on the public list, and any other language', async () => {
    await visit('/portal/students', 'en', true); await visit('/../etc', 'en', true); await visit('/pricing', 'fr', true);
    expect((await admin<{ n: number }>(db, `select count(*)::int n from public.site_visits`)).rows[0]!.n).toBe(3);
  });

  it('only the server can write: signed-in users, vendor staff and anonymous callers are refused', async () => {
    await expect(q(db, w.as(ids.ownerA, w.tenantA), `select public.record_visit('/', 'en', true)`)).rejects.toThrow(/permission denied/);
    await expect(q(db, w.as(ids.vendorAdmin, null), `select public.record_visit('/', 'en', true)`)).rejects.toThrow(/permission denied/);
    await expect(q(db, null, `select public.record_visit('/', 'en', true)`, [], 'anon')).rejects.toThrow(/permission denied/);
    await expect(q(db, w.as(ids.vendorAdmin, null), `insert into public.site_visits (path, lang, views) values ('/', 'en', 999)`)).rejects.toThrow(/permission denied|row-level security/);
  });

  it('vendor staff can read the totals; school users and anonymous callers see nothing', async () => {
    expect((await q(db, w.as(ids.vendorSupport, null), `select * from public.site_visits`)).rows.length).toBe(3);
    expect((await q(db, w.as(ids.ownerA, w.tenantA), `select * from public.site_visits`)).rows).toHaveLength(0);
    await expect(q(db, null, `select * from public.site_visits`, [], 'anon')).rejects.toThrow(/permission denied/);
  });

  it('stores nothing about a person: the table has only day, page, language and counts', async () => {
    const cols = (await admin<{ column_name: string }>(db, `select column_name from information_schema.columns where table_name = 'site_visits' order by 1`)).rows.map((c) => c.column_name);
    expect(cols).toEqual(['day', 'lang', 'path', 'views', 'visits']);
  });
});

describe('landing media, website settings and the school overview', () => {
  it('the public sees only ACTIVE media and every setting; only the super admin writes; support staff and school owners cannot', async () => {
    const sa = w.as(ids.vendorAdmin, null);
    await q(db, sa, `insert into public.site_media (kind, title_en, url, sort_order) values ('demo','Product tour','https://youtu.be/dQw4w9WgXcQ',1), ('reel','Hidden reel','https://www.instagram.com/reel/abc123/',2)`);
    await q(db, sa, `update public.site_media set is_active = false where title_en = 'Hidden reel'`);
    await q(db, sa, `insert into public.site_settings (key, value) values ('whatsapp','923001234567'), ('announcement_en','New: school bus tracking')`);
    expect((await q<{ title_en: string }>(db, null, `select title_en from public.site_media`, [], 'anon')).rows.map((r) => r.title_en)).toEqual(['Product tour']);
    expect((await q(db, null, `select key from public.site_settings`, [], 'anon')).rows).toHaveLength(2);
    expect((await q(db, w.as(ids.vendorSupport, null), `select 1 from public.site_media`)).rows).toHaveLength(2); // support staff see hidden ones too
    for (const who of [w.as(ids.vendorSupport, null), w.as(ids.ownerA, w.tenantA)]) {
      await expect(q(db, who, `insert into public.site_media (kind, title_en, url) values ('reel','x','https://example.com/x')`)).rejects.toThrow(/row-level security|permission denied/);
      await expect(q(db, who, `insert into public.site_settings (key, value) values ('phone','0300')`)).rejects.toThrow(/row-level security|permission denied/);
    }
    await expect(q(db, null, `insert into public.site_media (kind, title_en, url) values ('reel','x','https://example.com/x')`, [], 'anon')).rejects.toThrow(/permission denied/);
  });

  it('rejects unsafe links and unknown/markup settings', async () => {
    const sa = w.as(ids.vendorAdmin, null);
    await expect(q(db, sa, `insert into public.site_media (kind, title_en, url) values ('reel','x','javascript:alert(1)')`)).rejects.toThrow(/check constraint|violates/);
    await expect(q(db, sa, `insert into public.site_media (kind, title_en, url) values ('reel','x','http://insecure.example.com/v')`)).rejects.toThrow(/check constraint|violates/);
    await expect(q(db, sa, `insert into public.site_settings (key, value) values ('evil','x')`)).rejects.toThrow(/check constraint|violates/);
    await expect(q(db, sa, `insert into public.site_settings (key, value) values ('email','<script>')`)).rejects.toThrow(/check constraint|violates/);
  });

  it('vendor_overview gives counts per school to vendor staff only, and never any names or records', async () => {
    const { seedSchool } = await import('../helpers/school');
    await seedSchool(db, w, w.tenantA, ids.ownerA, '9');
    const rows = (await q<{ slug: string; students: number; members: number }>(db, w.as(ids.vendorSupport, null), `select * from public.vendor_overview()`)).rows;
    expect(rows.find((r) => r.slug === 'school-a')).toMatchObject({ students: 3 });
    expect(Object.keys(rows[0]!).sort()).toEqual(['created_at', 'members', 'name', 'plan_key', 'slug', 'staff', 'status', 'students', 'tenant_id']);
    await expect(q(db, w.as(ids.ownerA, w.tenantA), `select * from public.vendor_overview()`)).rejects.toThrow(/permission denied/);
    await expect(q(db, null, `select * from public.vendor_overview()`, [], 'anon')).rejects.toThrow(/permission denied/);
  });
});
