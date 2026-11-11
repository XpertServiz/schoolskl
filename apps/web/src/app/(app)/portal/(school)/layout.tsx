import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BackBar, NavBehavior } from '@/components/nav-behavior';
import { RememberSchool } from '@/components/remember-school';
import { setLocale } from '@/lib/locale-action';
import { portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function signOut() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/portal/login');
}

type Alert = { route_id: string; name: string; expected_arrival: string; grace_minutes: number; minutes_late: number; state: string };

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const p = await portal();
  const staff = !p.access.is_guardian || p.access.permissions.length > 0;
  type Item = { href: string; label: string; show: boolean };
  const L = p.l;
  // Who may manage access (the owner, or users.manage with 2FA) is decided by the database; one cheap call, only for school managers.
  const manageAccess = p.can('settings.manage') ? Boolean(((await p.sb.rpc('people_access')).data as { can?: boolean } | null)?.can) : false;
  const approver = p.can('fees.concession.approve') || p.can('payroll.post') || p.can('results.publish') || p.can('exams.marks.moderate');
  const money = p.can('fees.view') || p.can('fees.collect');
  const books = p.can('accounts.reports.view') || p.can('accounts.journal.create') || p.can('accounts.chart.edit');
  // Grouped by topic. A group with one visible item is shown as a plain link.
  const top: Item[] = [
    { href: '/portal', label: p.tr('nav.cockpit'), show: staff },
    { href: '/portal/family', label: p.tr('nav.myFamily'), show: p.access.is_guardian },
    { href: '/portal/transport/driver', label: L('My bus', 'میری بس'), show: p.access.is_crew === true && p.flag('saferoute') },
    { href: '/portal/approvals', label: p.tr('nav.approvals'), show: approver },
  ];
  const groups: { label: string; items: Item[] }[] = [
    { label: p.tr('nav.group.students'), items: [
      { href: '/portal/students', label: p.tr('nav.students'), show: p.can('students.view') },
      { href: '/portal/attendance', label: p.tr('nav.attendance'), show: p.can('attendance.mark') || p.can('attendance.view') },
      { href: '/portal/admissions', label: p.tr('nav.admissions'), show: p.has('admissions_crm') && p.can('admissions.manage') },
      { href: '/portal/exams', label: p.tr('nav.exams'), show: p.has('exams_kit') && (p.can('exams.marks.enter') || p.can('exams.marks.moderate') || p.can('results.publish')) },
      { href: '/portal/timetable', label: p.tr('nav.timetable'), show: p.can('timetable.manage') || p.can('attendance.mark') || p.can('attendance.view') },
    ] },
    { label: p.tr('nav.group.fees'), items: [
      { href: '/portal/fees', label: p.tr('nav.fees'), show: money },
      { href: '/portal/fees/concessions', label: p.tr('finance.nav.concessions'), show: p.can('fees.concession.request') || p.can('fees.concession.approve') },
      { href: '/portal/fees/setup', label: p.tr('finance.nav.setup'), show: p.can('fees.structure.edit') || p.can('fees.voucher.generate') },
    ] },
    { label: L('Accounting', 'اکاؤنٹنگ'), items: [
      { href: '/portal/accounts/chart', label: L('Chart of accounts', 'چارٹ آف اکاؤنٹس'), show: p.can('accounts.reports.view') || p.can('accounts.chart.edit') },
      { href: '/portal/accounts/journal', label: L('General journal', 'جنرل جرنل'), show: p.can('accounts.reports.view') || p.can('accounts.journal.create') },
      { href: '/portal/accounts/bank', label: L('Bank reconciliation', 'بینک ریکنسلی ایشن'), show: p.can('accounts.journal.create') || p.can('accounts.reports.view') || p.can('fees.collect') },
    ] },
    { label: L('Reports', 'رپورٹس'), items: [{ href: '/portal/reports', label: L('Reports', 'رپورٹس'), show: books || p.can('fees.view') }] },
    { label: p.tr('nav.group.team'), items: [
      { href: '/portal/access', label: L('Staff & permissions', 'اسٹاف اور اجازتیں'), show: manageAccess },
      { href: '/portal/people', label: p.tr('people.nav'), show: manageAccess },
      { href: '/portal/staff', label: p.can('staff.manage') ? p.tr('nav.staff') : L('My attendance', 'میری حاضری'), show: p.access.permissions.length > 0 },
      { href: '/portal/payroll', label: p.tr('nav.payroll'), show: p.has('payroll') && (p.can('payroll.prepare') || p.can('payroll.post')) },
      { href: '/portal/payslips', label: p.tr('finance.nav.payslips'), show: p.has('payroll') && p.access.permissions.length > 0 },
      { href: '/portal/transport', label: p.tr('transport.nav'), show: p.can('transport.manage') || p.can('tracking.live.view') || p.access.is_crew === true },
    ] },
    { label: p.tr('setup.nav'), items: [{ href: '/portal/setup', label: p.tr('setup.nav'), show: p.can('settings.manage') }] },
  ];
  const alerts = p.flag('saferoute') ? (((await p.sb.rpc('route_alerts')).data ?? []) as Alert[]) : [];
  return (
    <div className="shell">
      <NavBehavior />
      <RememberSchool name={p.access.tenant.name} />
      <header className="topbar">
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo-mark.png" alt="" height={24} style={{ height: 24, width: 'auto' }} />{p.access.tenant.name}</strong>
        <nav aria-label="Main">
          {top.filter((i) => i.show).map((i) => <Link key={i.href} href={i.href}>{i.label}</Link>)}
          {groups.map((g) => {
            const visible = g.items.filter((i) => i.show);
            if (visible.length === 0) return null;
            if (visible.length === 1) return <Link key={visible[0]!.href} href={visible[0]!.href}>{visible[0]!.label}</Link>;
            return (
              <details key={g.label} className="navgroup">
                <summary>{g.label}</summary>
                <div className="navmenu">{visible.map((i) => <Link key={i.href} href={i.href}>{i.label}</Link>)}</div>
              </details>
            );
          })}
        </nav>
        <div className="tools">
          <form action={setLocale}>
            <input type="hidden" name="to" value={p.locale === 'ur' ? 'en' : 'ur'} />
            <input type="hidden" name="back" value="/portal" />
            <button className="link" lang={p.locale === 'ur' ? 'en' : 'ur'}>{p.tr('nav.language')}</button>
          </form>
          <Link href="/portal/security">{p.tr('security.link')}</Link>
          <Link href="/portal/schools?switch=1">{p.tr('nav.switchSchool')}</Link>
          <form action={signOut}><button className="link">{p.tr('nav.signOut')}</button></form>
        </div>
      </header>
      {alerts.map((a) => (
        <p key={a.route_id} role="alert" className="notice alertbar">
          ⚠ {L(`Bus “${a.name}” has not reached school yet (expected ${String(a.expected_arrival).slice(0, 5)}, ${a.grace_minutes} min grace) — something may have happened.`,
              `بس “${a.name}” ابھی اسکول نہیں پہنچی (متوقع ${String(a.expected_arrival).slice(0, 5)}، ${a.grace_minutes} منٹ کی مہلت) — کچھ ہوا ہو سکتا ہے۔`)}{' '}
          {p.can('tracking.live.view') ? <Link href="/portal/transport/live">{L('Open live map', 'لائیو نقشہ کھولیں')}</Link> : p.access.is_guardian ? <Link href="/portal/family/bus">{L('See the bus', 'بس دیکھیں')}</Link> : null}
        </p>
      ))}
      {p.mfaOff && p.access.permissions.length > 0 ? <p role="status" className="notice"><Link href="/portal/security">{p.tr('security.banner')}</Link></p> : null}
      {p.access.tenant.status === 'suspended' ? <p role="status" className="notice">{p.tr('ui.readOnly')}</p> : null}
      <div className="wrap"><BackBar label={L('← Cockpit', '← کاک پٹ')} />{children}</div>
    </div>
  );
}
