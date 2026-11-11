import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { t } from '@ilmora/i18n';
import { BusMap, ageText } from '@/components/bus-map';
import { clock, type BusStatus } from '@/lib/bus';
import { done, fail, getLocale, type Portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

/** Consent is the parent's own decision, recorded and audited in the database (set_transport_consent); it can be withdrawn at any time. */
export async function setBusConsent(form: FormData) {
  'use server';
  const r = z.object({ student: z.string().uuid(), granted: z.enum(['1', '0']), back: z.enum(['/portal/family', '/portal/family/bus']) })
    .safeParse({ student: form.get('student'), granted: form.get('granted'), back: form.get('back') });
  if (!r.success) return fail('/portal/family', { message: 'invalid' });
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_transport_consent', { p_student: r.data.student, p_granted: r.data.granted === '1' });
  if (error) return fail(r.data.back, error);
  revalidatePath(r.data.back);
  done(r.data.back, t(await getLocale(), 'transport.saved'));
}

export function BusSection({ p, b, back, big = false }: { p: Portal; b: BusStatus; back: '/portal/family' | '/portal/family/bus'; big?: boolean }) {
  const tz = p.access.tenant.timezone;
  return (
    <div className="bus">
      <h3>{p.tr('transport.family.bus')} <span className="muted">· {b.route_name}{b.vehicle_label ? <span className="ltr"> · {b.vehicle_label}</span> : null}{b.stop_name ? <> · {b.stop_name}</> : null}</span></h3>
      {!b.saferoute_on ? <p className="muted">{p.tr('transport.off')}</p> : !b.consent ? (
        <form action={setBusConsent}>
          <p>{p.tr('transport.family.consentQ', { name: b.first_name })}</p>
          <p className="muted">{p.tr('transport.family.consentOff', { name: b.first_name })}</p>
          <input type="hidden" name="student" value={b.student_id} /><input type="hidden" name="granted" value="1" /><input type="hidden" name="back" value={back} />
          <button className="btn">{p.tr('transport.family.give')}</button>
        </form>
      ) : (
        <>
          {!b.trip_id ? <p className="muted">{p.tr('transport.family.noTrip')}</p> : (
            <>
              <p>
                <span className="pill">{p.tr(`transport.dir.${b.direction}`)}</span>{' '}
                {b.last_event ? p.tr(`transport.family.${b.last_event}`, { name: b.first_name, time: clock(b.last_event_at, tz) }) : p.tr('transport.family.onTheWay')}
              </p>
              {b.lat != null && b.lng != null ? (
                <>
                  <p className="muted">{p.tr('transport.updated', { time: ageText(b.position_at, p.locale) })}</p>
                  <BusMap lat={b.lat} lng={b.lng} label={b.route_name} height={big ? 380 : 240} />
                </>
              ) : b.last_event === 'alighted' ? <p className="muted">{p.tr('transport.family.hidden')}</p> : <p className="muted">{p.tr('transport.noFix')}</p>}
              {!big ? <p><Link href="/portal/family/bus">{p.tr('transport.family.openMap')}</Link></p> : null}
            </>
          )}
          <form action={setBusConsent} className="inline">
            <span className="muted">{p.tr('transport.family.consentOn')}</span>
            <input type="hidden" name="student" value={b.student_id} /><input type="hidden" name="granted" value="0" /><input type="hidden" name="back" value={back} />
            <button className="link">{p.tr('transport.family.withdraw')}</button>
          </form>
        </>
      )}
    </div>
  );
}
