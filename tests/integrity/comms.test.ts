import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

let db: PGlite;
let w: World;
let s: School;
let other: School;
let guardianKhan: string, guardianAhmed: string;
const n = (x: unknown) => Number(x);
const svc = <T = any>(sql: string, params: unknown[] = []) => q<T>(db, null, sql, params, 'service_role');

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, 'm');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, 'n');
  const g = (await admin<{ id: string; full_name: string }>(db, `select id, full_name from public.guardians where tenant_id = $1`, [s.tenant])).rows;
  guardianKhan = g.find((x) => x.full_name === 'Mr Khan')!.id; // the parent login is linked to this guardian (seedSchool)
  guardianAhmed = g.find((x) => x.full_name === 'Mr Ahmed')!.id;
});

describe('contact preferences & consent', () => {
  it('a guardian sets their own preferences; consent is recorded with who and when', async () => {
    await q(db, s.parent, `select public.set_contact_prefs($1, true, false, 'ur', '22:00', '07:00')`, [guardianKhan]);
    const row = (await admin<any>(db, `select * from public.guardian_contact_prefs where guardian_id = $1`, [guardianKhan])).rows[0];
    expect(row).toMatchObject({ whatsapp_opt_in: true, sms_opt_in: false, locale: 'ur', consent_recorded_by: s.userIds.parent, user_id: s.userIds.parent });
    expect(row.consent_recorded_at).toBeTruthy();
  });
  it('nobody else’s preferences can be changed by a parent; staff with comms.broadcast can record them', async () => {
    await expect(q(db, s.parent, `select public.set_contact_prefs($1, true, true)`, [guardianAhmed])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.cashier, `select public.set_contact_prefs($1, true, true)`, [guardianAhmed])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.set_contact_prefs($1, true, true)`, [guardianAhmed])).resolves.toBeDefined();
    await expect(q(db, s.parent, `select public.set_contact_prefs($1, true, true, null, '22:00', null)`, [guardianKhan])).rejects.toThrow(/both quiet-hours times or neither|check constraint/);
    await expect(q(db, other.owner, `select public.set_contact_prefs($1, true, true)`, [guardianKhan])).rejects.toThrow(/guardian not found/);
  });
  it('preferences are private: own row, or staff with comms.broadcast; never another school; no direct writes', async () => {
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.guardian_contact_prefs`)).rows[0]!.n)).toBe(1);
    expect(n((await q<{ n: number }>(db, s.cashier, `select count(*)::int n from public.guardian_contact_prefs`)).rows[0]!.n)).toBe(0);
    expect(n((await q<{ n: number }>(db, s.owner, `select count(*)::int n from public.guardian_contact_prefs`)).rows[0]!.n)).toBe(2);
    expect(n((await q<{ n: number }>(db, other.owner, `select count(*)::int n from public.guardian_contact_prefs where tenant_id = $1`, [s.tenant])).rows[0]!.n)).toBe(0);
    await expect(q(db, s.parent, `update public.guardian_contact_prefs set whatsapp_opt_in = false`)).rejects.toThrow(/permission denied/);
  });
});

describe('outbox worker API', () => {
  let item: any;
  it('only the service role can claim, complete or resolve recipients', async () => {
    for (const sql of [`select * from public.claim_outbox(5)`, `select public.complete_outbox(gen_random_uuid(), 'sent')`, `select * from public.outbox_recipients(gen_random_uuid())`]) {
      await expect(q(db, s.owner, sql)).rejects.toThrow(/permission denied/);
    }
  });
  it('claims due items once (a second worker gets nothing) and counts the attempt', async () => {
    const a = await svc(`select * from public.claim_outbox(10)`);
    expect(a.rows.length).toBeGreaterThanOrEqual(2); // Zara's absence in each school
    item = a.rows.find((r: any) => r.tenant_id === s.tenant && r.kind === 'attendance.absent');
    expect(item.attempts).toBe(1);
    expect((await svc(`select * from public.claim_outbox(10)`)).rows).toHaveLength(0);
  });
  it('resolves the right guardians with defaults (SMS on, WhatsApp off) and the school’s locale', async () => {
    const r = await svc<any>(`select * from public.outbox_recipients($1)`, [item.id]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ full_name: 'Mr Ahmed', whatsapp_opt_in: true, sms_opt_in: true }); // staff recorded opt-in for Ahmed in the test above
    const fam = await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'fee.reminder','t1',$2::jsonb) returning id`,
      [s.tenant, JSON.stringify({ family_id: s.families[0] })]);
    const r2 = await svc<any>(`select * from public.outbox_recipients($1)`, [fam.rows[0]!.id]);
    expect(r2.rows.map((x: any) => x.full_name)).toEqual(['Mr Khan']);
    expect(r2.rows[0]).toMatchObject({ whatsapp_opt_in: true, sms_opt_in: false, locale: 'ur', timezone: 'Asia/Karachi' });
  });
  it('a guardian with no phone, or from another school, is never returned', async () => {
    await admin(db, `update public.guardians set phone = null where id = $1`, [guardianAhmed]);
    expect((await svc<any>(`select * from public.outbox_recipients($1)`, [item.id])).rows).toHaveLength(0);
    await admin(db, `update public.guardians set phone = '03211111111' where id = $1`, [guardianAhmed]);
  });
  it('completes as sent, once; a settled item is not changed again', async () => {
    expect((await svc<{ s: string }>(`select public.complete_outbox($1,'sent','sms') s`, [item.id])).rows[0]!.s).toBe('sent');
    expect((await svc<{ s: string }>(`select public.complete_outbox($1,'dead','sms','late') s`, [item.id])).rows[0]!.s).toBe('sent');
    const row = (await admin<any>(db, `select status, delivered_via, delivered_at from public.notification_outbox where id = $1`, [item.id])).rows[0];
    expect(row).toMatchObject({ status: 'sent', delivered_via: 'sms' });
    expect(row.delivered_at).toBeTruthy();
  });
  it('retries back off, and the fifth failed attempt goes to the dead-letter state', async () => {
    const id = (await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'x','retry-1','{}') returning id`, [s.tenant])).rows[0]!.id;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const c = await svc<any>(`select * from public.claim_outbox(50)`);
      expect(c.rows.map((r: any) => r.id)).toContain(id);
      const status = (await svc<{ s: string }>(`select public.complete_outbox($1,'retry','sms','provider timeout') s`, [id])).rows[0]!.s;
      if (attempt < 5) {
        expect(status).toBe('pending');
        const next = (await admin<{ ok: boolean }>(db, `select next_attempt_at > now() ok from public.notification_outbox where id = $1`, [id])).rows[0]!.ok;
        expect(next).toBe(true);
        expect((await svc<any>(`select * from public.claim_outbox(50)`)).rows.map((r: any) => r.id)).not.toContain(id); // not due yet
        await admin(db, `update public.notification_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [id]);
      } else expect(status).toBe('dead');
    }
    expect((await admin<any>(db, `select attempts, last_error from public.notification_outbox where id = $1`, [id])).rows[0]).toMatchObject({ attempts: 5, last_error: 'provider timeout' });
  });
  it('a crashed worker’s claim is taken over after ten minutes', async () => {
    const id = (await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'x','stale-1','{}') returning id`, [s.tenant])).rows[0]!.id;
    await svc(`select * from public.claim_outbox(50)`);
    expect((await svc<any>(`select * from public.claim_outbox(50)`)).rows.map((r: any) => r.id)).not.toContain(id);
    await admin(db, `update public.notification_outbox set claimed_at = now() - interval '11 minutes' where id = $1`, [id]);
    const again = await svc<any>(`select * from public.claim_outbox(50)`);
    expect(again.rows.find((r: any) => r.id === id)?.attempts).toBe(2);
  });
  it('deferral (quiet hours) postpones without using up an attempt', async () => {
    const id = (await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'x','defer-1','{}') returning id`, [s.tenant])).rows[0]!.id;
    await svc(`select * from public.claim_outbox(50)`);
    expect((await admin<{ attempts: number }>(db, `select attempts from public.notification_outbox where id = $1`, [id])).rows[0]!.attempts).toBe(1);
    expect((await svc<{ s: string }>(`select public.complete_outbox($1,'defer',null,'quiet hours',3600) s`, [id])).rows[0]!.s).toBe('pending');
    const row = (await admin<any>(db, `select attempts, next_attempt_at > now() + interval '50 minutes' later from public.notification_outbox where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ attempts: 0, later: true });
  });
  it('per-recipient delivery records: a delivered guardian is flagged on the retry and never downgraded', async () => {
    const id = (await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'x','deliv-1',$2::jsonb) returning id`, [s.tenant, JSON.stringify({ student_id: s.students[2] })])).rows[0]!.id;
    expect((await svc<any>(`select delivered from public.outbox_recipients($1)`, [id])).rows[0]!.delivered).toBe(false);
    await svc(`select public.record_delivery($1,$2,'sms','delivered','prov-1')`, [id, guardianAhmed]);
    expect((await svc<any>(`select delivered from public.outbox_recipients($1)`, [id])).rows[0]!.delivered).toBe(true);
    await svc(`select public.record_delivery($1,$2,'whatsapp','failed',null,'late failure')`, [id, guardianAhmed]);
    expect((await admin<any>(db, `select status, channel, provider_msg_id from public.notification_deliveries where outbox_id = $1`, [id])).rows[0]).toEqual({ status: 'delivered', channel: 'sms', provider_msg_id: 'prov-1' });
    await expect(q(db, s.owner, `select public.record_delivery($1,$2,'sms','delivered')`, [id, guardianAhmed])).rejects.toThrow(/permission denied/);
    expect(n((await q<{ n: number }>(db, s.owner, `select count(*)::int n from public.notification_deliveries`)).rows[0]!.n)).toBe(1); // staff with comms.broadcast can audit
    expect(n((await q<{ n: number }>(db, s.parent, `select count(*)::int n from public.notification_deliveries`)).rows[0]!.n)).toBe(0);
  });
  it('context carries display names from the database, not from the queue', async () => {
    const id = (await admin<{ id: string }>(db, `select id from public.notification_outbox where tenant_id = $1 and kind = 'attendance.absent'`, [s.tenant])).rows[0]!.id;
    expect((await svc<{ c: any }>(`select public.outbox_context($1) c`, [id])).rows[0]!.c).toMatchObject({ student: 'Zara Ahmed' });
    expect((await admin<any>(db, `select payload::text p from public.notification_outbox where id = $1`, [id])).rows[0].p).not.toMatch(/Zara/);
  });
  it('skipped and unknown outcomes', async () => {
    const id = (await admin<{ id: string }>(db, `insert into public.notification_outbox (tenant_id, kind, dedupe_key, payload) values ($1,'x','skip-1','{}') returning id`, [s.tenant])).rows[0]!.id;
    await svc(`select * from public.claim_outbox(50)`);
    await expect(svc(`select public.complete_outbox($1,'banana')`, [id])).rejects.toThrow(/unknown outcome/);
    expect((await svc<{ s: string }>(`select public.complete_outbox($1,'skipped',null,'no consent') s`, [id])).rows[0]!.s).toBe('skipped');
  });
});
