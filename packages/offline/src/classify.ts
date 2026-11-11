import type { Outcome } from './queue';

/** Shape of a Supabase/PostgREST error (or a thrown fetch failure). */
export interface RpcError { message?: string; code?: string; status?: number }

/**
 * Decide what a failed RPC means for the queue:
 *  - no response / 5xx / 408 / 429  → retry later (the phone is offline or the server is busy);
 *  - 401                            → retry: the session expired and will be refreshed, the change is still valid;
 *  - everything else (permission denied 42501, a rule such as "attendance day is locked", bad input) → rejected, show it to the person.
 * Rejecting is deliberate for rule errors: retrying a locked day forever would hide the problem from the teacher.
 */
export function classifyRpcError(err: RpcError | null | undefined): Outcome {
  if (!err) return { status: 'done' };
  const msg = err.message ?? 'unknown error';
  const status = err.status ?? 0;
  if (status === 0 && !err.code) return { status: 'retry', error: msg }; // fetch failed / offline
  if (status >= 500 || status === 408 || status === 429 || status === 401) return { status: 'retry', error: msg };
  return { status: 'rejected', reason: msg };
}
