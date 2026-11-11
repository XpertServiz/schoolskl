import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bars, Donut, Meter } from '@/components/charts';
import { LiveBuses } from '@/components/live-buses';
import { Flash } from '@/components/flash';
import { portal } from '@/lib/portal';
import { setupSteps, type Progress } from '@/lib/setup';

export const metadata = { title: 'Cockpit', robots: { index: false, follow: false } };

interface Cockpit {
  date: string;
  students?: { active: number };
  fees?: { outstanding_minor: number; overdue_minor: number; overdue_families: number; collected_today_minor: number; collected_month_minor: number; unmatched_bank_lines: number };
  attendance?: { sections_marked: number; sections_total: number; present: number; absent: number };
  admissions?: { open: number; follow_ups_due: number };
  pending_approvals: number;
}

const Stat = ({ label, value, href }: { label: string; value: string; href?: string }) => {
  const body = <><span className="num">{value}</span><span className="label">{label}</span></>;
  return href ? <Link href={href} className="card stat" style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : <div className="card stat">{body}</div>;
};

export default async function Cockpit({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  const { data } = await p.sb.rpc('school_cockpit');
  const c = (data ?? { pending_approvals: 0 }) as Cockpit;
  const n = (x: number) => new Intl.NumberFormat(p.locale === 'ur' ? 'ur-PK' : 'en-PK').format(x);

  // A guardian-only login has no staff data; send them to their family page instead of an empty cockpit.
  if (p.access.is_guardian && !c.fees && !c.students && !c.attendance) {
    return <p><Link className="btn" href="/portal/family">{p.tr('nav.myFamily')}</Link></p>;
  }
  // A driver / attendant has no school numbers: their home is the bus screen.
  if (p.access.is_crew && !c.fees && !c.students && !c.attendance && p.flag('saferoute')) redirect('/portal/transport/driver');

  // Series for the charts: only what this person is allowed to read (RLS decides; we just skip the calls they cannot make).
  const since = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const [coll, aging, att] = await Promise.all([
    c.fees ? p.sb.from('v_collection_daily').select('received_on, collected_minor').gte('received_on', since(13)) : Promise.resolve({ data: [] }),
    c.fees ? p.sb.from('v_fee_aging').select('bucket, balance_minor') : Promise.resolve({ data: [] }),
    c.attendance ? p.sb.from('v_attendance_daily').select('att_date, total, present, absent').gte('att_date', since(6)) : Promise.resolve({ data: [] }),
  ]);
  const days14 = Array.from({ length: 14 }, (_, i) => since(13 - i));
  const byDay = new Map<string, number>();
  for (const r of coll.data ?? []) byDay.set(r.received_on as string, (byDay.get(r.received_on as string) ?? 0) + Number(r.collected_minor));
  const collSeries = days14.map((d) => ({ label: d.slice(5), value: byDay.get(d) ?? 0 }));
  const buckets = ['current', '0-30', '31-60', '61-90', '90+'];
  const ageMap = new Map<string, number>();
  for (const r of aging.data ?? []) ageMap.set(r.bucket as string, (ageMap.get(r.bucket as string) ?? 0) + Number(r.balance_minor));
  const days7 = Array.from({ length: 7 }, (_, i) => since(6 - i));
  const attMap = new Map<string, { t: number; pr: number }>();
  for (const r of att.data ?? []) { const x = attMap.get(r.att_date as string) ?? { t: 0, pr: 0 }; x.t += Number(r.total); x.pr += Number(r.present); attMap.set(r.att_date as string, x); }
  const attSeries = days7.map((d) => ({ label: d.slice(5), value: attMap.get(d)?.t ? Math.round(((attMap.get(d)!.pr) / attMap.get(d)!.t) * 100) : 0 }));
  // Only people who can change the school's setup see "finish setting up"; others never call setup_progress (it would refuse them).
  let setup: { done: number; total: number } | null = null;
  if (p.can('settings.manage')) {
    const { data: pr } = await p.sb.rpc('setup_progress');
    const steps = setupSteps((pr ?? {}) as Partial<Progress>, !p.mfaOff);
    setup = { done: steps.filter((s) => s.done).length, total: steps.length };
  }

  // the four things a beginner does every day, one click away (each shown only if this person may do it)
  const quick = ([
    p.can('students.create') && { href: '/portal/students', label: p.tr('quick.addStudent') },
    p.can('attendance.mark') && { href: '/portal/attendance', label: p.tr('quick.attendance') },
    p.can('fees.collect') && { href: '/portal/fees', label: p.tr('quick.collect') },
    (p.can('users.manage') || p.can('settings.manage')) && { href: '/portal/people', label: p.tr('quick.addPerson') },
  ].filter(Boolean)) as { href: string; label: string }[];

  return (
    <>
      <h1>{p.tr('cockpit.title')}</h1>
      <p className="muted ltr">{c.date}</p>
      <Flash sp={sp} />
      {quick.length ? <div className="quick">{quick.map((x) => <Link key={x.href} className="btn" href={x.href}>{x.label}</Link>)}</div> : null}
      {setup && setup.done < setup.total ? (
        <p role="status" className="notice"><Link href="/portal/setup">{p.tr('setup.banner', { done: setup.done, total: setup.total })}</Link></p>
      ) : null}
      <div className="stats">
        <Stat label={p.tr('cockpit.approvals')} value={n(c.pending_approvals)} href="/portal/approvals" />
        {c.students ? <Stat label={p.tr('cockpit.students')} value={n(c.students.active)} href="/portal/students" /> : null}
        {c.fees ? (
          <>
            <Stat label={p.tr('cockpit.collectedToday')} value={p.fmt(c.fees.collected_today_minor)} href="/portal/fees" />
            <Stat label={p.tr('cockpit.collectedMonth')} value={p.fmt(c.fees.collected_month_minor)} />
            <Stat label={p.tr('cockpit.outstanding')} value={p.fmt(c.fees.outstanding_minor)} href="/portal/fees" />
            <Stat label={`${p.tr('cockpit.overdue')} · ${p.tr('cockpit.overdueFamilies', { count: n(c.fees.overdue_families) })}`} value={p.fmt(c.fees.overdue_minor)} href="/portal/fees?overdue=1" />
            {c.fees.unmatched_bank_lines > 0 ? <Stat label={p.tr('cockpit.unmatched')} value={n(c.fees.unmatched_bank_lines)} href="/portal/approvals" /> : null}
          </>
        ) : null}
        {c.attendance ? (
          <>
            <Stat label={`${p.tr('cockpit.attendance')} · ${p.tr('cockpit.present')}`} value={n(c.attendance.present)} href="/portal/attendance" />
            <Stat label={`${p.tr('cockpit.attendance')} · ${p.tr('cockpit.absent')}`} value={n(c.attendance.absent)} href="/portal/attendance" />
            <Stat label={p.tr('cockpit.marked', { done: n(c.attendance.sections_marked), total: n(c.attendance.sections_total) })} value={`${n(c.attendance.sections_marked)}/${n(c.attendance.sections_total)}`} />
          </>
        ) : null}
        {c.admissions ? (
          <>
            <Stat label={p.tr('cockpit.admissions')} value={n(c.admissions.open)} href="/portal/admissions" />
            <Stat label={p.tr('cockpit.followUps')} value={n(c.admissions.follow_ups_due)} href="/portal/admissions" />
          </>
        ) : null}
      </div>

      {c.fees || c.attendance ? (
        <div className="chartgrid">
          {c.fees ? (
            <>
              <section className="card"><h3 style={{ marginTop: 0 }}>{p.l('Fees collected — last 14 days', 'فیس وصولی — پچھلے 14 دن')}</h3><Bars data={collSeries} fmt={p.fmt} title={p.l('Fees collected per day', 'روزانہ فیس وصولی')} /></section>
              <section className="card"><h3 style={{ marginTop: 0 }}>{p.l('Collected vs outstanding (month)', 'ماہانہ: وصول بمقابلہ بقایا')}</h3>
                <Donut title={p.l('Collected versus outstanding', 'وصول بمقابلہ بقایا')} center={c.fees.collected_month_minor + c.fees.outstanding_minor > 0 ? Math.round((c.fees.collected_month_minor / (c.fees.collected_month_minor + c.fees.outstanding_minor)) * 100) + '%' : '—'}
                  parts={[{ label: p.l('Collected', 'وصول') + ' ' + p.fmt(c.fees.collected_month_minor), value: c.fees.collected_month_minor, color: '#14b8a6' }, { label: p.l('Outstanding', 'بقایا') + ' ' + p.fmt(c.fees.outstanding_minor), value: c.fees.outstanding_minor, color: '#f59e0b' }]} /></section>
              <section className="card"><h3 style={{ marginTop: 0 }}>{p.l('Who owes — by age', 'بقایا — عمر کے لحاظ سے')}</h3><Bars data={buckets.map((b) => ({ label: b, value: ageMap.get(b) ?? 0 }))} fmt={p.fmt} title={p.l('Outstanding fees by age', 'بقایا فیس بلحاظ عمر')} /></section>
            </>
          ) : null}
          {c.attendance ? (
            <section className="card"><h3 style={{ marginTop: 0 }}>{p.l('Attendance % — last 7 days', 'حاضری % — پچھلے 7 دن')}</h3>
              <Bars data={attSeries} fmt={(n) => n + '%'} title={p.l('Attendance percent per day', 'روزانہ حاضری فیصد')} />
              <Meter value={c.attendance.sections_marked} of={c.attendance.sections_total} label={p.l('Registers taken today', 'آج کی حاضری رجسٹر')} />
            </section>
          ) : null}
        </div>
      ) : null}
      <LiveBuses p={p} />
    </>
  );
}
