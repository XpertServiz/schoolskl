import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { z } from 'zod';
import { t } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { PrintButton } from '@/components/print-button';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Bus cards', robots: { index: false, follow: false } };

async function reissue(form: FormData) {
  'use server';
  const id = z.string().uuid().parse(form.get('route'));
  const back = `/portal/transport/cards/${id}`;
  const sb = await supabaseServer();
  const { error } = await sb.rpc('route_cards', { p_route: id, p_reissue: true });
  if (error) return fail(back, error);
  revalidatePath(back);
  done(back, t(await getLocale(), 'transport.saved'));
}

/**
 * Printable QR bus cards for one route. The QR holds only "SR1:<random token>" — no name, school or phone — so a lost card tells a finder
 * nothing; the name printed beside it is for the child and the driver. Opening this page issues a card to any rider who has none
 * (route_cards is idempotent); "re-issue" revokes every card on the route and prints new ones.
 */
export default async function BusCards({ params, searchParams }: { params: Promise<{ route: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  need(p, 'transport.manage');
  const { route } = await params;
  if (!z.string().uuid().safeParse(route).success) notFound();
  const sp = await searchParams;
  const [{ data: r }, { data: cards, error }] = await Promise.all([
    p.sb.from('transport_routes').select('id, name, vehicle_label').eq('id', route).maybeSingle(),
    p.sb.rpc('route_cards', { p_route: route, p_reissue: false }),
  ]);
  if (!r) notFound();
  type Card = { student_id: string; full_name: string; admission_no: string; class_name: string | null; stop_name: string | null; token: string };
  const list = ((cards ?? []) as Card[]);
  const svgs = await Promise.all(list.map((c) => QRCode.toString(`SR1:${c.token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })));

  return (
    <>
      <p className="no-print inline"><Link href="/portal/transport">← {p.tr('ui.back')}</Link><PrintButton label={p.tr('ui.print')} /></p>
      <h1>{p.tr('transport.cardsTitle', { route: r.name })}</h1>
      <Flash sp={error ? { err: error.message } : sp} />
      <p className="muted no-print">{p.tr('transport.cardHint')}</p>
      {list.length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : null}
      <div className="buscards">
        {list.map((c, i) => (
          <div key={c.student_id} className="buscard">
            <span dangerouslySetInnerHTML={{ __html: svgs[i]! }} />
            <div>
              <strong>{c.full_name}</strong>
              <span className="muted ltr">{c.admission_no}</span>{c.class_name ? <> · {c.class_name}</> : null}
              <div>{r.name}{r.vehicle_label ? <span className="ltr"> · {r.vehicle_label}</span> : null}</div>
              {c.stop_name ? <div className="muted">{p.tr('transport.stop')}: {c.stop_name}</div> : null}
              <div className="muted">{p.access.tenant.name}</div>
            </div>
          </div>
        ))}
      </div>
      <form action={reissue} className="no-print" style={{ marginTop: '2rem' }}>
        <input type="hidden" name="route" value={r.id} />
        <button className="btn secondary">{p.tr('transport.reissue')}</button>
      </form>
    </>
  );
}
