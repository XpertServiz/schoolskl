/**
 * Offline write queue for the mobile apps (teacher attendance first). Pure TypeScript with an injected key-value storage, so the same code
 * runs on a phone (AsyncStorage / SecureStore) and in tests.
 *
 * Guarantees:
 *  - nothing is lost: every change is persisted before enqueue() resolves, and an op leaves the queue only when the server accepted it
 *    (done) or definitively refused it (rejected → kept in `failed` so the person can see what did not go through);
 *  - nothing is sent twice by accident: ops are sent one at a time in order, each carries a stable id the server can de-duplicate on,
 *    and a second flush() while one is running is a no-op;
 *  - the latest state wins: enqueue() with a `dedupeKey` replaces an older pending op for the same thing (re-marking the same register);
 *  - an unreachable server never burns attempts on later ops: the first transient failure stops the run and backs off.
 */

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface QueuedOp {
  id: string;
  kind: string;
  payload: unknown;
  dedupeKey?: string;
  createdAt: number;
  attempts: number;
  /** earliest time (ms epoch) this op may be tried again */
  nextAt: number;
  lastError?: string;
}
export interface FailedOp extends QueuedOp { failedAt: number; reason: string }

/** What a handler tells the queue about one attempt. */
export type Outcome = { status: 'done' } | { status: 'retry'; error: string } | { status: 'rejected'; reason: string };
export type Handler = (op: QueuedOp) => Promise<Outcome>;

interface State { pending: QueuedOp[]; failed: FailedOp[] }
export interface FlushResult { sent: number; rejected: number; remaining: number; stoppedForRetry: boolean }

const MAX_BACKOFF_MS = 60 * 60 * 1000;
export const backoffMs = (attempts: number): number => Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** Math.max(0, attempts - 1));

export class OfflineQueue {
  private flushing = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = 'offline-queue.v1',
    private readonly newId: () => string = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  ) {}

  private async load(): Promise<State> {
    const raw = await this.storage.get(this.key);
    if (!raw) return { pending: [], failed: [] };
    try {
      const s = JSON.parse(raw) as State;
      return { pending: Array.isArray(s.pending) ? s.pending : [], failed: Array.isArray(s.failed) ? s.failed : [] };
    } catch {
      return { pending: [], failed: [] }; // unreadable state must never brick the app; the server remains the source of truth
    }
  }

  /** All reads-modify-writes go through one chain so two quick taps cannot interleave and drop a change. */
  private mutate<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const s = await this.load();
      const out = await fn(s);
      await this.storage.set(this.key, JSON.stringify(s));
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async enqueue(kind: string, payload: unknown, opts: { dedupeKey?: string; now?: number } = {}): Promise<string> {
    const now = opts.now ?? Date.now();
    return this.mutate((s) => {
      if (opts.dedupeKey) s.pending = s.pending.filter((o) => o.dedupeKey !== opts.dedupeKey);
      const op: QueuedOp = { id: this.newId(), kind, payload, dedupeKey: opts.dedupeKey, createdAt: now, attempts: 0, nextAt: now };
      s.pending.push(op);
      return op.id;
    });
  }

  async pending(): Promise<QueuedOp[]> { return (await this.load()).pending; }
  async failed(): Promise<FailedOp[]> { return (await this.load()).failed; }
  async size(): Promise<number> { return (await this.load()).pending.length; }

  /** The person has seen the rejected items; clear them. */
  async dismissFailed(): Promise<void> { await this.mutate((s) => { s.failed = []; }); }

  async flush(handlers: Record<string, Handler>, now: () => number = Date.now): Promise<FlushResult> {
    if (this.flushing) return { sent: 0, rejected: 0, remaining: await this.size(), stoppedForRetry: false };
    this.flushing = true;
    let sent = 0, rejected = 0, stoppedForRetry = false;
    try {
      for (;;) {
        const head = (await this.load()).pending[0];
        if (!head || head.nextAt > now()) break; // oldest first; if it is backing off, so is everything behind it (order preserved)
        const handler = handlers[head.kind];
        const outcome: Outcome = handler ? await safe(handler, head) : { status: 'rejected', reason: `no handler for "${head.kind}"` };
        if (outcome.status === 'done') {
          await this.mutate((s) => { s.pending = s.pending.filter((o) => o.id !== head.id); });
          sent++;
        } else if (outcome.status === 'rejected') {
          await this.mutate((s) => {
            s.pending = s.pending.filter((o) => o.id !== head.id);
            s.failed.push({ ...head, failedAt: now(), reason: outcome.reason });
          });
          rejected++;
        } else {
          await this.mutate((s) => {
            const o = s.pending.find((x) => x.id === head.id);
            if (o) { o.attempts += 1; o.lastError = outcome.error; o.nextAt = now() + backoffMs(o.attempts); }
          });
          stoppedForRetry = true;
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    return { sent, rejected, remaining: await this.size(), stoppedForRetry };
  }
}

async function safe(h: Handler, op: QueuedOp): Promise<Outcome> {
  try { return await h(op); } catch (e) { return { status: 'retry', error: (e as Error).message }; } // a thrown error is "try again", never "lose it"
}
