import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { classifyRpcError, OfflineQueue, type Handler } from '@ilmora/offline';
import { supabase } from './supabase';

/** One queue per device. The key includes nothing user-specific on purpose: sign-out must not silently delete unsent registers. */
export const queue = new OfflineQueue({ get: (k) => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v) }, 'school.offline.v1');

export interface AttendanceOp { section: string; date: string; absent: string[]; late: string[]; leave: string[] }

/**
 * mark_attendance overwrites the register for (section, day), so replaying an op is safe and the latest enqueue (same dedupeKey) is the only
 * one that matters. The server still enforces the class-scoped permission, the day lock and "not in the future" — a refusal comes back as
 * `rejected` and is shown to the teacher instead of retrying forever.
 */
const handlers: Record<string, Handler> = {
  'attendance.mark': async (op) => {
    const p = op.payload as AttendanceOp;
    const r = await supabase.rpc('mark_attendance', { p_section: p.section, p_date: p.date, p_absent: p.absent, p_late: p.late, p_leave: p.leave });
    return classifyRpcError(r.error ? { message: r.error.message, code: r.error.code, status: r.status } : null);
  },
};

export const attendanceKey = (section: string, date: string) => `attendance:${section}:${date}`;

export function flushQueue() {
  return queue.flush(handlers);
}

/** Flush at start-up and whenever the phone regains a connection. Returns an unsubscribe. */
export function startSync(onChange?: () => void): () => void {
  const run = async () => { await flushQueue(); onChange?.(); };
  void run();
  const unsub = NetInfo.addEventListener((s) => { if (s.isConnected && s.isInternetReachable !== false) void run(); });
  const timer = setInterval(() => void run(), 60_000); // back-off lives in the queue; this just gives it a chance to retry
  return () => { unsub(); clearInterval(timer); };
}
