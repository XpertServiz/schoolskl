import { NextResponse } from 'next/server';
import { cronAuthorised } from '@/lib/cron';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Nightly fee jobs for every active school: late fines, instalment-plan and promise review, reminder ladder.
 * One school failing never stops the others; each result (or error) is reported per school. Schedule it once or twice a day —
 * every step is idempotent (see run_nightly). The reminders it queues are delivered by /api/jobs/outbox.
 */
export async function POST(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ ok: false, code: 'unauthorised' }, { status: 401 });
  const sb = supabaseService();
  const { data: tenants, error } = await sb.from('tenants').select('id, slug').in('status', ['trial', 'onboarding', 'live']);
  if (error) return NextResponse.json({ ok: false, code: 'tenant_list_failed' }, { status: 500 });

  const results: Record<string, unknown> = {};
  let failed = 0;
  for (const t of tenants ?? []) {
    const { data, error: e } = await sb.rpc('run_nightly', { p_tenant: t.id, p_as_of: null });
    if (e) { failed++; results[t.slug] = { error: e.message }; } else results[t.slug] = data;
  }
  // SafeRoute retention: bus positions older than 30 days go; trips a dead phone left open are closed (all schools, one call)
  const { data: purged, error: pe } = await sb.rpc('purge_transport_positions', { p_days: 30 });
  if (pe) failed++;
  return NextResponse.json({ ok: failed === 0, schools: tenants?.length ?? 0, failed, results, transport: pe ? { error: pe.message } : { purged } }, { status: failed ? 207 : 200 });
}
