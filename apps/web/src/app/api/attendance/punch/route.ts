import { z } from 'zod';
import { allow, clientIp } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({ token: z.string().min(32).max(80), employee_no: z.string().min(1).max(30), at: z.string().datetime({ offset: true }).optional() });

/**
 * Entry point for a fingerprint / face / card machine (or the small bridge program that reads the machine's own database and forwards its
 * punches here). The device key (shown once in Staff → Attendance machines) identifies the school; the employee number says who punched.
 * The database decides in/out and never edits an earlier check-in. Answers carry no school data.
 */
export async function POST(req: Request) {
  if (!allow('punch', await clientIp(), 600, 60)) return Response.json({ result: 'rate_limited' }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ result: 'bad_request' }, { status: 400 });
  const at = parsed.data.at ? new Date(parsed.data.at) : new Date();
  if (Math.abs(Date.now() - at.getTime()) > 7 * 86400000) return Response.json({ result: 'bad_time' }, { status: 400 });
  const { data, error } = await supabaseService().rpc('ingest_punch', { p_token: parsed.data.token, p_employee_no: parsed.data.employee_no, p_at: at.toISOString() });
  if (error) return Response.json({ result: 'unknown_device' }, { status: 401 });
  return Response.json({ result: data });
}
