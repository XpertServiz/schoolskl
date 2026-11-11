import { describe, expect, it, vi } from 'vitest';
import { backoffMs, classifyRpcError, OfflineQueue, type Handler, type KeyValueStorage } from './index';

const memory = (): KeyValueStorage & { raw: Map<string, string> } => {
  const raw = new Map<string, string>();
  return { raw, get: async (k) => raw.get(k) ?? null, set: async (k, v) => void raw.set(k, v) };
};
let n = 0;
const make = (s = memory()) => ({ s, q: new OfflineQueue(s, 'q', () => `op${++n}`) });
const ok: Handler = async () => ({ status: 'done' });

describe('OfflineQueue', () => {
  it('persists before enqueue resolves, so a crash right after cannot lose the change', async () => {
    const { s, q } = make();
    await q.enqueue('attendance', { section: 'a' });
    const reloaded = new OfflineQueue(s, 'q'); // a fresh process reading the same storage
    expect((await reloaded.pending()).map((o) => o.kind)).toEqual(['attendance']);
  });

  it('sends oldest first, one at a time, and removes only accepted ops', async () => {
    const { q } = make();
    await q.enqueue('a', 1); await q.enqueue('b', 2); await q.enqueue('c', 3);
    const order: string[] = [];
    const r = await q.flush({ a: async (o) => (order.push(o.kind), { status: 'done' }), b: async (o) => (order.push(o.kind), { status: 'done' }), c: async (o) => (order.push(o.kind), { status: 'done' }) });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ sent: 3, remaining: 0, stoppedForRetry: false });
  });

  it('the latest state wins: a dedupeKey replaces the older pending op, never the order of others', async () => {
    const { q } = make();
    await q.enqueue('att', { absent: ['x'] }, { dedupeKey: 'att:s1:d1' });
    await q.enqueue('other', {});
    await q.enqueue('att', { absent: ['x', 'y'] }, { dedupeKey: 'att:s1:d1' });
    const p = await q.pending();
    expect(p.map((o) => o.kind)).toEqual(['other', 'att']);
    expect(p[1]!.payload).toEqual({ absent: ['x', 'y'] });
  });

  it('a transient failure stops the run, keeps order, and backs off — later ops are not attempted', async () => {
    const { q } = make();
    let t = 1_000_000;
    await q.enqueue('a', 1, { now: t }); await q.enqueue('b', 2, { now: t });
    const b = vi.fn(ok);
    const r = await q.flush({ a: async () => ({ status: 'retry', error: 'offline' }), b }, () => t);
    expect(b).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: 0, remaining: 2, stoppedForRetry: true });
    const [head] = await q.pending();
    expect(head).toMatchObject({ attempts: 1, lastError: 'offline', nextAt: t + backoffMs(1) });
    // too early: nothing is attempted
    const a2 = vi.fn(ok);
    await q.flush({ a: a2, b }, () => t + 1000);
    expect(a2).not.toHaveBeenCalled();
    // after the back-off both go through, in order
    t += backoffMs(1) + 1;
    expect(await q.flush({ a: ok, b: ok }, () => t)).toMatchObject({ sent: 2, remaining: 0 });
  });

  it('a definitive refusal moves the op to "failed" with the reason and lets the rest continue', async () => {
    const { q } = make();
    await q.enqueue('a', 1); await q.enqueue('b', 2);
    const r = await q.flush({ a: async () => ({ status: 'rejected', reason: 'attendance day is locked' }), b: ok });
    expect(r).toMatchObject({ sent: 1, rejected: 1, remaining: 0 });
    expect((await q.failed())[0]).toMatchObject({ kind: 'a', reason: 'attendance day is locked' });
    await q.dismissFailed();
    expect(await q.failed()).toEqual([]);
  });

  it('an unknown kind is rejected visibly, and a handler that throws is retried, never dropped', async () => {
    const { q } = make();
    await q.enqueue('mystery', 1);
    expect(await q.flush({})).toMatchObject({ rejected: 1 });
    await q.enqueue('boom', 1);
    const r = await q.flush({ boom: async () => { throw new Error('socket hang up'); } });
    expect(r).toMatchObject({ stoppedForRetry: true, remaining: 1 });
    expect((await q.pending())[0]!.lastError).toBe('socket hang up');
  });

  it('a second flush while one is running does not double-send', async () => {
    const { q } = make();
    await q.enqueue('a', 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = vi.fn(async () => { await gate; return { status: 'done' } as const; });
    const first = q.flush({ a: h });
    await new Promise((r) => setTimeout(r, 5));
    const second = await q.flush({ a: h });
    expect(second.sent).toBe(0);
    release();
    expect((await first).sent).toBe(1);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('concurrent enqueues from quick taps are all kept', async () => {
    const { q } = make();
    await Promise.all(Array.from({ length: 20 }, (_, i) => q.enqueue('a', i)));
    expect(await q.size()).toBe(20);
  });

  it('corrupt stored state does not brick the queue', async () => {
    const s = memory();
    s.raw.set('q', '{not json');
    const q = new OfflineQueue(s, 'q');
    expect(await q.size()).toBe(0);
    await expect(q.enqueue('a', 1)).resolves.toBeTruthy();
  });

  it('back-off grows and is capped at an hour', () => {
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(2)).toBe(30_000);
    expect(backoffMs(30)).toBe(3_600_000);
  });
});

describe('classifyRpcError', () => {
  it('maps offline/server/session errors to retry and rule errors to rejected', () => {
    expect(classifyRpcError(null)).toEqual({ status: 'done' });
    expect(classifyRpcError({ message: 'Failed to fetch' })).toMatchObject({ status: 'retry' });
    expect(classifyRpcError({ message: 'bad gateway', status: 502 })).toMatchObject({ status: 'retry' });
    expect(classifyRpcError({ message: 'JWT expired', status: 401 })).toMatchObject({ status: 'retry' });
    expect(classifyRpcError({ message: 'too many', status: 429 })).toMatchObject({ status: 'retry' });
    expect(classifyRpcError({ message: 'permission denied', status: 403, code: '42501' })).toEqual({ status: 'rejected', reason: 'permission denied' });
    expect(classifyRpcError({ message: 'attendance for this day is locked', status: 400, code: 'P0001' })).toMatchObject({ status: 'rejected' });
  });
});
