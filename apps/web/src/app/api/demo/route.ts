import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pkMobileSchema } from '@ilmora/validation';
import { supabaseService } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const clean = (v: FormDataEntryValue | null, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s === '' ? undefined : s; };

const schema = z.object({
  name: z.string().min(2), school: z.string().min(2), city: z.string().optional(), email: z.string().email().optional(),
  size: z.enum(['lt300', '300_1000', '1000_3000', 'gt3000']).optional(), message: z.string().optional(), locale: z.enum(['en', 'ur']),
});

/**
 * Public lead form. The visitor never touches the database: this handler validates, drops bots (honeypot), and inserts with the service
 * role into a table that only vendor staff can read. A repeat from the same number on the same day is treated as already received.
 */
export async function POST(req: Request) {
  const base = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${base}/demo?${q}`, 303);
  const form = await req.formData();

  if (String(form.get('website') ?? '') !== '') return back('sent=1'); // honeypot filled: look successful, store nothing

  const phone = pkMobileSchema.safeParse(form.get('phone'));
  if (!phone.success) return back('err=phone');
  const r = schema.safeParse({
    name: clean(form.get('name'), 120), school: clean(form.get('school'), 160), city: clean(form.get('city'), 80), email: clean(form.get('email'), 160),
    size: clean(form.get('size'), 20), message: clean(form.get('message'), 1000), locale: form.get('locale') === 'ur' ? 'ur' : 'en',
  });
  if (!r.success) return back('err=fields');

  try {
    const { error } = await supabaseService().from('demo_requests').insert({
      full_name: r.data.name, school_name: r.data.school, city: r.data.city ?? null, phone: phone.data, email: r.data.email ?? null,
      students_band: r.data.size ?? null, message: r.data.message ?? null, locale: r.data.locale,
    });
    if (error && error.code !== '23505') return back('err=failed'); // 23505 = same number already asked today → fine
  } catch {
    return back('err=failed');
  }
  return back('sent=1');
}
