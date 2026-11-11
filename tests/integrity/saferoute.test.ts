import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { admin, buildWorld, createDb, ids, q, type Claims, type World } from '../helpers/db';
import { seedSchool, type School } from '../helpers/school';

/**
 * SafeRoute, free version: the driver's phone shares the BUS position, children carry printed QR cards, parents see the bus only with
 * their own recorded consent and only until their child is off the bus. Children: Amna (s0) and Zara (s2) ride route "Route 1";
 * Bilal (s1) does not. The parent login belongs to Amna and Bilal's family.
 */
let db: PGlite;
let w: World;
let s: School;
let other: School;
let driver: Claims;
let route: string;
let cards: Record<string, string>;
let trip: string;

const addStaffLogin = async (tenant: string, roleKey: string, name: string) => {
  const id = randomUUID();
  await admin(db, `insert into auth.users (id, email) values ($1, $2)`, [id, `${name}-${id.slice(0, 6)}@example.test`]);
  await admin(db, `insert into public.profiles (user_id, full_name) values ($1, $2)`, [id, name]);
  await admin(db, `insert into public.user_tenants (tenant_id, user_id) values ($1, $2)`, [tenant, id]);
  await admin(db, `insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where tenant_id = $1 and key = $3`, [tenant, id, roleKey]);
  const staff = (await admin<{ id: string }>(db, `insert into public.staff_members (tenant_id, user_id, employee_no, full_name, designation) values ($1,$2,$3,$4,'Driver') returning id`, [tenant, id, `D-${id.slice(0, 4)}`, name])).rows[0]!.id;
  return { id, staff };
};

const events = async (student: string) =>
  (await admin<{ kind: string }>(db, `select kind from public.transport_events where student_id = $1 order by at`, [student])).rows.map((r) => r.kind);

beforeAll(async () => {
  db = await createDb();
  w = await buildWorld(db);
  s = await seedSchool(db, w, w.tenantA, ids.ownerA, '5');
  other = await seedSchool(db, w, w.tenantB, ids.ownerB, '6');
  const d = await addStaffLogin(s.tenant, 'driver', 'Driver Aslam');
  driver = w.as(d.id, s.tenant);
  route = (await q<{ id: string }>(db, s.owner, `insert into public.transport_routes (tenant_id, campus_id, name, vehicle_label, driver_staff_id) values ($1,$2,'Route 1','LES-1234',$3) returning id`, [s.tenant, s.campus, d.staff])).rows[0]!.id;
  await q(db, s.owner, `insert into public.transport_riders (tenant_id, student_id, route_id, stop_name) values ($1,$2,$4,'Model Town'),($1,$3,$4,'Garden Town')`, [s.tenant, s.students[0], s.students[2], route]);
});

describe('switching SafeRoute on', () => {
  it('nothing starts while the school has not switched the saferoute flag on', async () => {
    await expect(q(db, driver, `select public.start_trip($1,'to_school')`, [route])).rejects.toThrow(/saferoute is not switched on/);
    const r = (await q<{ saferoute_on: boolean }>(db, driver, `select * from public.my_transport_routes()`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0]!.saferoute_on).toBe(false);
    await admin(db, `insert into public.tenant_flags (tenant_id, flag_key, enabled) values ($1,'saferoute',true)`, [s.tenant]);
    expect((await q<{ flags: string[] }>(db, s.owner, `select public.my_access() -> 'flags' as flags`)).rows[0]!.flags).toContain('saferoute');
    expect((await q<{ c: boolean }>(db, driver, `select (public.my_access() ->> 'is_crew')::boolean c`)).rows[0]!.c).toBe(true);
  });
});

describe('QR cards', () => {
  it('a manager prints one card per rider; the QR holds only a random token', async () => {
    const rows = (await q<{ student_id: string; full_name: string; token: string; class_name: string }>(db, s.owner, `select * from public.route_cards($1)`, [route])).rows;
    expect(rows.map((r) => r.full_name).sort()).toEqual(['Amna Khan', 'Zara Ahmed']);
    for (const r of rows) expect(r.token).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]!.class_name).toBe('Grade 5');
    // printing again returns the same cards
    const again = (await q<{ token: string }>(db, s.owner, `select * from public.route_cards($1)`, [route])).rows.map((r) => r.token).sort();
    expect(again).toEqual(rows.map((r) => r.token).sort());
    cards = Object.fromEntries(rows.map((r) => [r.student_id, r.token]));
  });

  it('only transport managers print cards or read them; the driver, a cashier and a parent cannot', async () => {
    for (const who of [driver, s.cashier, s.parent]) {
      await expect(q(db, who, `select * from public.route_cards($1)`, [route])).rejects.toThrow(/permission denied/);
      expect((await q(db, who, `select * from public.transport_cards`)).rows).toHaveLength(0);
    }
    await expect(q(db, other.owner, `select * from public.route_cards($1)`, [route])).rejects.toThrow(/route not found/);
  });
});

describe('parent consent', () => {
  it('a guardian records consent for their own child only; nobody else can give it', async () => {
    await q(db, s.parent, `select public.set_transport_consent($1, true)`, [s.students[0]]);
    await expect(q(db, s.parent, `select public.set_transport_consent($1, true)`, [s.students[2]])).rejects.toThrow(/permission denied/);
    await expect(q(db, driver, `select public.set_transport_consent($1, true)`, [s.students[2]])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.owner, `select public.set_transport_consent($1, true)`, [s.students[2]])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `insert into public.transport_consents (tenant_id, student_id, guardian_id, recorded_by) select tenant_id, $1, guardian_id, $2 from public.student_guardians where student_id = $1`, [s.students[2], s.userIds.parent])).rejects.toThrow(/permission denied/);
    const c = (await admin<{ n: number }>(db, `select count(*)::int n from public.transport_consents where tenant_id = $1 and revoked_at is null`, [s.tenant])).rows[0]!.n;
    expect(c).toBe(1);
  });
});

describe('a trip', () => {
  it('only the route crew or a transport manager starts it; starting twice resumes the open trip', async () => {
    await expect(q(db, s.cashier, `select public.start_trip($1,'to_school')`, [route])).rejects.toThrow(/permission denied/);
    await expect(q(db, s.parent, `select public.start_trip($1,'to_school')`, [route])).rejects.toThrow(/permission denied/);
    trip = (await q<{ id: string }>(db, driver, `select public.start_trip($1,'to_school') id`, [route])).rows[0]!.id;
    expect((await q<{ id: string }>(db, driver, `select public.start_trip($1,'to_home') id`, [route])).rows[0]!.id).toBe(trip);
  });

  it('scanning: consented rider boards, a double scan is ignored, no-consent / unknown / wrong-route are reported and NOT recorded', async () => {
    const scan = async (code: string, kind: string | null = null) =>
      (await q<{ r: { result: string; name?: string } }>(db, driver, `select public.scan_transport_card($1,$2,$3) r`, [trip, code, kind])).rows[0]!.r;
    expect(await scan(`SR1:${cards[s.students[0]!]!.toUpperCase()}`)).toEqual({ result: 'boarded', name: 'Amna', kind: 'boarded' });
    expect((await scan(`SR1:${cards[s.students[0]!]}`)).result).toBe('duplicate');
    expect(await scan(`SR1:${cards[s.students[2]!]}`)).toEqual({ result: 'no_consent', name: 'Zara' });
    expect((await scan('SR1:' + 'f'.repeat(32))).result).toBe('unknown_card');
    expect((await scan('hello')).result).toBe('unknown_card');
    const bilal = (await q<{ r: { result: string } }>(db, driver, `select public.mark_rider($1,$2,'boarded') r`, [trip, s.students[1]])).rows[0]!.r;
    expect(bilal.result).toBe('not_on_route');
    expect(await events(s.students[0]!)).toEqual(['boarded']);
    expect(await events(s.students[2]!)).toEqual([]);
    expect(await events(s.students[1]!)).toEqual([]);
  });

  it('the crew list shows first names, consent and state — never full names', async () => {
    const rows = (await q<{ first_name: string; consent: boolean; state: string | null }>(db, driver, `select * from public.trip_riders($1)`, [trip])).rows;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ first_name: 'Amna', consent: true, state: 'boarded' }),
      expect.objectContaining({ first_name: 'Zara', consent: false, state: null }),
    ]));
    await expect(q(db, s.cashier, `select * from public.trip_riders($1)`, [trip])).rejects.toThrow(/permission denied/);
  });

  it('positions: only the crew posts them, out-of-window points and duplicates are dropped', async () => {
    const now = Date.now();
    const pts = [
      { lat: 31.5204, lng: 74.3587, accuracy: 12, at: new Date(now - 20000).toISOString() },
      { lat: 31.5210, lng: 74.3592, accuracy: 9, at: new Date(now - 10000).toISOString() },
      { lat: 31.5210, lng: 74.3592, accuracy: 9, at: new Date(now - 10000).toISOString() }, // duplicate
      { lat: 31.6, lng: 74.4, at: new Date(now - 3 * 3600_000).toISOString() },           // before the trip started
    ];
    const n = (await q<{ n: number }>(db, driver, `select public.post_trip_positions($1,$2::jsonb) n`, [trip, JSON.stringify(pts)])).rows[0]!.n;
    expect(n).toBe(2);
    await expect(q(db, s.cashier, `select public.post_trip_positions($1,$2::jsonb)`, [trip, JSON.stringify(pts)])).rejects.toThrow(/permission denied/);
    await expect(q(db, other.owner, `select public.post_trip_positions($1,$2::jsonb)`, [trip, JSON.stringify(pts)])).rejects.toThrow(/permission denied|not switched on/);
    await expect(q(db, driver, `insert into public.transport_positions (tenant_id, trip_id, lat, lng, recorded_at) values ($1,$2,1,1,now())`, [s.tenant, trip])).rejects.toThrow(/permission denied/);
  });

  it('staff with tracking.live.view see the live bus; a cashier or teacher does not, and another school sees nothing', async () => {
    const live = (await q<{ route_name: string; lat: number; on_board: number; riders: number }>(db, s.owner, `select * from public.live_trips()`)).rows;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ route_name: 'Route 1', lat: 31.521, on_board: 1, riders: 2 });
    await expect(q(db, s.cashier, `select * from public.live_trips()`)).rejects.toThrow(/permission denied/);
    expect((await q(db, s.cashier, `select * from public.transport_positions`)).rows).toHaveLength(0);
    expect((await q(db, other.owner, `select * from public.live_trips()`)).rows).toHaveLength(0);
  });

  it('the parent sees the bus for their consented child while the child is on it — and not after the child gets off', async () => {
    type Row = { first_name: string; consent: boolean; trip_id: string | null; last_event: string | null; lat: number | null };
    const status = async () => (await q<Row>(db, s.parent, `select * from public.my_bus_status()`)).rows;
    let rows = await status();
    expect(rows).toHaveLength(1); // Bilal is not on a route; Zara is not their child
    expect(rows[0]).toMatchObject({ first_name: 'Amna', consent: true, trip_id: trip, last_event: 'boarded', lat: 31.521 });
    // the 2-minute double-scan guard: move the boarding back in time, then get off
    await admin(db, `update public.transport_events set at = now() - interval '30 minutes' where student_id = $1`, [s.students[0]]);
    const off = (await q<{ r: { result: string } }>(db, driver, `select public.scan_transport_card($1,$2) r`, [trip, cards[s.students[0]!]])).rows[0]!.r;
    expect(off.result).toBe('alighted');
    rows = await status();
    expect(rows[0]).toMatchObject({ last_event: 'alighted', lat: null });
  });

  it('withdrawing consent hides the trip from the parent and stops new boarding records', async () => {
    await q(db, s.parent, `select public.set_transport_consent($1, false)`, [s.students[0]]);
    const rows = (await q<{ consent: boolean; trip_id: string | null; lat: number | null }>(db, s.parent, `select * from public.my_bus_status()`)).rows;
    expect(rows[0]).toMatchObject({ consent: false, trip_id: null, lat: null });
    await admin(db, `update public.transport_events set at = now() - interval '10 minutes' where student_id = $1`, [s.students[0]]);
    const r = (await q<{ r: { result: string } }>(db, driver, `select public.scan_transport_card($1,$2) r`, [trip, cards[s.students[0]!]])).rows[0]!.r;
    expect(r.result).toBe('no_consent');
    await q(db, s.parent, `select public.set_transport_consent($1, true)`, [s.students[0]]); // and given again
    expect((await q<{ consent: boolean }>(db, s.parent, `select consent from public.my_bus_status()`)).rows[0]!.consent).toBe(true);
    const audit = (await admin<{ n: number }>(db, `select count(*)::int n from public.audit_log where table_name = 'transport_consents'`)).rows[0]!.n;
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it('ending the trip reports children still on board; an ended trip takes no scans or positions', async () => {
    await admin(db, `update public.transport_events set at = now() - interval '10 minutes' where student_id = $1`, [s.students[0]]);
    await q(db, driver, `select public.mark_rider($1,$2,'boarded')`, [trip, s.students[0]]);
    const end = (await q<{ r: { still_on_board: number } }>(db, driver, `select public.end_trip($1) r`, [trip])).rows[0]!.r;
    expect(end.still_on_board).toBe(1);
    await expect(q(db, driver, `select public.scan_transport_card($1,$2)`, [trip, cards[s.students[0]!]])).rejects.toThrow(/trip has ended/);
    await expect(q(db, driver, `select public.post_trip_positions($1,'[]'::jsonb)`, [trip])).rejects.toThrow(/trip has ended/);
    expect((await q(db, s.parent, `select trip_id from public.my_bus_status() where trip_id is not null`)).rows).toHaveLength(0);
  });

  it('re-issuing cards kills the old QR codes', async () => {
    const t2 = (await q<{ id: string }>(db, driver, `select public.start_trip($1,'to_home') id`, [route])).rows[0]!.id;
    await q(db, s.owner, `select * from public.route_cards($1, true)`, [route]);
    const r = (await q<{ r: { result: string } }>(db, driver, `select public.scan_transport_card($1,$2) r`, [t2, cards[s.students[0]!]])).rows[0]!.r;
    expect(r.result).toBe('unknown_card');
    await q(db, driver, `select public.end_trip($1)`, [t2]);
  });
});

describe('retention', () => {
  it('purging old positions is a service-role job only', async () => {
    await expect(q(db, s.owner, `select public.purge_transport_positions(30)`)).rejects.toThrow(/permission denied/);
    await admin(db, `update public.transport_positions set recorded_at = recorded_at - interval '40 days'`);
    const n = (await q<{ n: number }>(db, null, `select public.purge_transport_positions(30) n`, [], 'service_role')).rows[0]!.n;
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
