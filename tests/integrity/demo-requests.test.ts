import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';

let db: PGlite;
let w: World;

const lead = (phone = '923001234567', extra = '') =>
  q(db, null, `insert into public.demo_requests (full_name, school_name, phone ${extra ? ', ' + extra.split('=')[0] : ''}) values ('Ayesha Malik','Noor Academy',$1 ${extra ? ', ' + extra.split('=')[1] : ''})`, [phone], 'service_role');

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
});

describe('demo requests', () => {
  it('the server (service role) can record a lead; nobody else can create one', async () => {
    await expect(lead()).resolves.toBeDefined();
    await expect(q(db, null, `insert into public.demo_requests (full_name, school_name, phone) values ('A B','C D','923001112222')`, [], 'anon')).rejects.toThrow(/permission denied/);
    await expect(q(db, w.as(ids.ownerA, w.tenantA), `insert into public.demo_requests (full_name, school_name, phone) values ('A B','C D','923001112222')`)).rejects.toThrow(/permission denied/);
    await expect(q(db, w.as(ids.vendorAdmin, null), `insert into public.demo_requests (full_name, school_name, phone) values ('A B','C D','923001112222')`)).rejects.toThrow(/permission denied/);
  });

  it('one number is one lead per day', async () => {
    await expect(lead()).rejects.toThrow(/duplicate key|demo_requests_phone_day/);
    await expect(lead('923009998888')).resolves.toBeDefined();
  });

  it('rejects junk: bad phone, tiny name, oversize message', async () => {
    await expect(lead('abc')).rejects.toThrow(/check constraint/);
    await expect(q(db, null, `insert into public.demo_requests (full_name, school_name, phone) values ('A','Noor Academy','923001230000')`, [], 'service_role')).rejects.toThrow(/check constraint/);
    await expect(q(db, null, `insert into public.demo_requests (full_name, school_name, phone, message) values ('Ayesha Malik','Noor Academy','923001230001', repeat('x', 1001))`, [], 'service_role')).rejects.toThrow(/check constraint/);
  });

  it('only vendor staff can read or work leads — never a school, a parent, or the public', async () => {
    expect(Number((await q<{ c: string }>(db, w.as(ids.vendorSupport, null), `select count(*) c from public.demo_requests`)).rows[0]!.c)).toBe(2);
    expect(Number((await q<{ c: string }>(db, w.as(ids.ownerA, w.tenantA), `select count(*) c from public.demo_requests`)).rows[0]!.c)).toBe(0);
    expect(Number((await q<{ c: string }>(db, w.as(ids.parentAB, w.tenantA), `select count(*) c from public.demo_requests`)).rows[0]!.c)).toBe(0);
    await expect(q(db, null, `select * from public.demo_requests`, [], 'anon')).rejects.toThrow(/permission denied/);
    await q(db, w.as(ids.vendorSupport, null), `update public.demo_requests set handled_at = now(), handled_by = $1`, [ids.vendorSupport]);
    expect(Number((await admin<{ c: string }>(db, `select count(*) c from public.demo_requests where handled_at is not null`)).rows[0]!.c)).toBe(2);
    await expect(q(db, w.as(ids.vendorSupport, null), `delete from public.demo_requests`)).rejects.toThrow(/permission denied/);
  });
});
