import { redirect } from 'next/navigation';
import Link from 'next/link';
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

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const p = await portal();
  const staff = !p.access.is_guardian || p.access.permissions.length > 0;
  type Item = { href: string; label: string; show: boolean };
  // Grouped so an owner sees 3 menus instead of 14 links; a group with a single visible item is shown as a plain link.
  const top: Item[] = [
    { href: '/portal', label: p.tr('nav.cockpit'), show: staff },
    { href: '/portal/approvals', label: p.tr('nav.approvals'), show: staff },
    { href: '/portal/family', label: p.tr('nav.myFamily'), show: p.access.is_guardian },
    { href: '/portal/setup', label: p.tr('setup.nav'), show: p.can('settings.manage') },
    // users.manage needs 2FA; an owner without it still sees the link and is told how to turn 2FA on
    { href: '/portal/people', label: p.tr('people.nav'), show: p.can('users.manage') || (p.mfaOff && p.can('settings.manage')) },
  ];
  const groups: { label: string; items: Item[] }[] = [
    { label: p.tr('nav.group.people'), items: [
      { href: '/portal/students', label: p.tr('nav.students'), show: p.can('students.view') },
      { href: '/portal/attendance', label: p.tr('nav.attendance'), show: p.can('attendance.mark') || p.can('attendance.view') },
      { href: '/portal/staff', label: p.tr('nav.staff'), show: p.access.permissions.length > 0 }, // the page itself narrows to "my check-in" for plain staff
      { href: '/portal/admissions', label: p.tr('nav.admissions'), show: p.has('admissions_crm') && p.can('admissions.manage') },
      { href: '/portal/transport', label: p.tr('transport.nav'), show: p.can('transport.manage') || p.can('tracking.live.view') },
    ] },
    { label: p.tr('nav.group.money'), items: [
      { href: '/portal/fees', label: p.tr('nav.fees'), show: p.can('fees.view') || p.can('fees.collect') },
      { href: '/portal/fees/setup', label: p.tr('finance.nav.setup'), show: p.can('fees.structure.edit') || p.can('fees.voucher.generate') },
      { href: '/portal/fees/concessions', label: p.tr('finance.nav.concessions'), show: p.can('fees.concession.request') || p.can('fees.concession.approve') },
      { href: '/portal/fees/reconcile', label: p.tr('finance.nav.reconcile'), show: p.can('accounts.journal.create') || p.can('fees.collect') },
      { href: '/portal/accounts', label: p.tr('nav.accounts'), show: p.can('accounts.reports.view') },
      { href: '/portal/payroll', label: p.tr('nav.payroll'), show: p.has('payroll') && (p.can('payroll.prepare') || p.can('payroll.post')) },
      { href: '/portal/payslips', label: p.tr('finance.nav.payslips'), show: p.has('payroll') && p.access.permissions.length > 0 }, // staff only: a parent has no payslips
    ] },
    { label: p.tr('nav.group.academics'), items: [
      { href: '/portal/exams', label: p.tr('nav.exams'), show: p.has('exams_kit') && (p.can('exams.marks.moderate') || p.can('results.publish')) },
      { href: '/portal/timetable', label: p.tr('nav.timetable'), show: p.can('timetable.manage') || p.can('attendance.mark') || p.can('attendance.view') },
    ] },
  ];
  return (
    <div className="shell">
      <header className="topbar">
        <strong>{p.access.tenant.name}</strong>
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
          <Link href="/portal/schools">{p.tr('nav.switchSchool')}</Link>
          <form action={signOut}><button className="link">{p.tr('nav.signOut')}</button></form>
        </div>
      </header>
      {p.mfaOff && p.access.permissions.length > 0 ? <p role="status" className="notice"><Link href="/portal/security">{p.tr('security.banner')}</Link></p> : null}
      {p.access.tenant.status === 'suspended' ? <p role="status" className="notice">{p.tr('ui.readOnly')}</p> : null}
      <div className="wrap">{children}</div>
    </div>
  );
}
