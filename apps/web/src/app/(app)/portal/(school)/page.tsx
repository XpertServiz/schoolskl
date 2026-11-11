import Link from 'next/link';
import { Flash } from '@/components/flash';
import { portal } from '@/lib/portal';

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

  return (
    <>
      <h1>{p.tr('cockpit.title')}</h1>
      <p className="muted ltr">{c.date}</p>
      <Flash sp={sp} />
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
    </>
  );
}
