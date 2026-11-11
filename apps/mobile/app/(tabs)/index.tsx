import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Bar, Card, Chip, color, Empty, ErrorText, gradient, H1, H2, Loading, Muted, Screen, T, Tile } from '@/lib/ui';

interface Child { id: string; full_name: string; admission_no: string }
interface Att { student_id: string; status: string }
interface Cock {
  students?: { active: number };
  fees?: { outstanding_minor: number; overdue_minor: number; collected_today_minor: number };
  attendance?: { sections_marked: number; sections_total: number; present: number; absent: number };
  admissions?: { open: number };
  pending_approvals?: number;
}

const greetingKey = () => { const h = new Date().getHours(); return h < 12 ? 'mobile.home.morning' : h < 17 ? 'mobile.home.afternoon' : 'mobile.home.evening'; };

/**
 * Home. Parents: their children with 30-day attendance. School staff: today's numbers (school_cockpit returns only the blocks this login
 * may see). Everyone: quick tiles for what they may do. RLS/RPC checks happen in the database; this screen only chooses what to show.
 */
export default function Home() {
  const { tr, fmt, access, can, rtl } = useApp();
  const router = useRouter();
  const [kids, setKids] = useState<Child[] | null>(null);
  const [att, setAtt] = useState<Att[]>([]);
  const [cock, setCock] = useState<Cock | null>(null);
  const [me, setMe] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const guardian = !!access?.is_guardian;
  const staff = (access?.permissions.length ?? 0) > 0;
  const saferoute = (access?.flags ?? []).includes('saferoute');

  const load = useCallback(async () => {
    setErr(null);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data: u } = await supabase.auth.getSession(); // local (cached) — no network round trip
    const [c, a, p, k] = await Promise.all([
      guardian ? supabase.from('students').select('id, full_name, admission_no').order('full_name') : Promise.resolve({ data: [], error: null }),
      guardian ? supabase.from('student_attendance').select('student_id, status').gte('att_date', since) : Promise.resolve({ data: [], error: null }),
      u.session?.user ? supabase.from('profiles').select('full_name').eq('user_id', u.session.user.id).maybeSingle() : Promise.resolve({ data: null }),
      staff ? supabase.rpc('school_cockpit') : Promise.resolve({ data: null }),
    ]);
    if (c.error) setErr(c.error.message);
    setKids((c.data ?? []) as Child[]);
    setAtt((a.data ?? []) as Att[]);
    setCock((k.data as Cock | null) ?? null);
    setMe(((p.data as { full_name?: string } | null)?.full_name ?? '').split(' ')[0] ?? '');
  }, [guardian, staff]);
  useEffect(() => { void load(); }, [load]);

  const go = (path: string) => router.push(path as never);
  const approver = can('fees.concession.approve') || can('payroll.post') || can('results.publish');
  const tiles = [
    guardian && { icon: 'wallet-outline' as const, label: tr('nav.fees'), tint: color.ok, path: '/fees' },
    guardian && { icon: 'school-outline' as const, label: tr('family.results'), tint: color.violet, path: '/results' },
    guardian && saferoute && { icon: 'bus-outline' as const, label: tr('transport.family.bus'), tint: color.accent, path: '/bus' },
    can('students.view') && !guardian && { icon: 'people-outline' as const, label: tr('nav.students'), tint: color.info, path: '/students' },
    (can('fees.view') || can('fees.collect')) && !guardian && { icon: 'cash-outline' as const, label: tr('ma.tab.dues'), tint: color.ok, path: '/dues' },
    approver && !guardian && { icon: 'shield-checkmark-outline' as const, label: tr('nav.approvals'), tint: color.accent, path: '/approvals' },
    can('attendance.mark') && { icon: 'checkbox-outline' as const, label: tr('nav.attendance'), tint: color.info, path: '/attendance' },
    (access?.is_crew || can('transport.manage')) && saferoute && { icon: 'navigate-outline' as const, label: tr('transport.drive.title'), tint: color.accent, path: '/drive' },
    (can('users.manage') || can('settings.manage')) && { icon: 'person-add-outline' as const, label: tr('ma.tab.people'), tint: color.violet, path: '/people' },
    { icon: 'person-circle-outline' as const, label: tr('mobile.tab.more'), tint: color.ink2, path: '/more' },
  ].filter(Boolean) as { icon: 'wallet-outline'; label: string; tint: string; path: string }[];

  const stat = (label: string, value: string, tint: string = color.ink, path?: string) => (
    <Card key={label} style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Muted>{label}</Muted>
      <T ltr style={{ fontSize: 24, fontWeight: '900', color: tint }} onPress={path ? () => go(path) : undefined}>{value}</T>
    </Card>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <LinearGradient colors={gradient.hero} style={{ padding: 22, paddingTop: 14, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 14 }}>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={me || access?.tenant.name || '?'} size={54} />
            <View style={{ flex: 1 }}>
              <Muted>{tr(greetingKey())}</Muted>
              <H1 numberOfLines={1}>{me || access?.tenant.name}</H1>
            </View>
          </View>
          <Chip label={access?.tenant.name ?? ''} />
        </LinearGradient>

        <View style={{ padding: 18, gap: 16 }}>
          {cock && !guardian ? (
            <>
              <H2>{tr('cockpit.title')}</H2>
              <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 12 }}>
                {cock.pending_approvals != null ? stat(tr('cockpit.approvals'), String(cock.pending_approvals), cock.pending_approvals > 0 ? color.accent : color.ok, '/approvals') : null}
                {cock.students ? stat(tr('cockpit.students'), String(cock.students.active), color.ink, '/students') : null}
                {cock.fees ? stat(tr('cockpit.collectedToday'), fmt(cock.fees.collected_today_minor), color.ok, '/dues') : null}
                {cock.fees ? stat(tr('cockpit.outstanding'), fmt(cock.fees.outstanding_minor), color.accent, '/dues') : null}
                {cock.fees ? stat(tr('cockpit.overdue'), fmt(cock.fees.overdue_minor), color.danger, '/dues') : null}
                {cock.attendance ? stat(`${tr('cockpit.attendance')} · ${tr('cockpit.present')}`, String(cock.attendance.present), color.ok, '/attendance') : null}
                {cock.attendance ? stat(`${tr('cockpit.attendance')} · ${tr('cockpit.absent')}`, String(cock.attendance.absent), color.danger, '/attendance') : null}
                {cock.admissions ? stat(tr('cockpit.admissions'), String(cock.admissions.open), color.info) : null}
              </View>
            </>
          ) : null}

          <H2>{tr('mobile.home.quick')}</H2>
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 12 }}>
            {tiles.map((x) => <Tile key={x.path} icon={x.icon} label={x.label} tint={x.tint} onPress={() => go(x.path)} />)}
          </View>

          {guardian ? (
            <>
              <H2>{tr('mobile.home.children')}</H2>
              {kids === null && !err ? <Loading /> : null}
              {err ? <ErrorText>{err}</ErrorText> : null}
              {(kids ?? []).map((k) => {
                const days = att.filter((x) => x.student_id === k.id);
                const present = days.filter((x) => x.status === 'present' || x.status === 'late').length;
                const rate = days.length ? present / days.length : 0;
                return (
                  <Card key={k.id}>
                    <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
                      <Avatar name={k.full_name} size={46} />
                      <View style={{ flex: 1 }}>
                        <T style={{ fontWeight: '800', fontSize: 18 }}>{k.full_name}</T>
                        <Muted ltr>{k.admission_no}</Muted>
                      </View>
                      <T ltr style={{ fontWeight: '900', fontSize: 20, color: rate >= 0.9 ? color.ok : rate >= 0.75 ? color.accent : color.danger }}>{days.length ? `${Math.round(rate * 100)}%` : '—'}</T>
                    </View>
                    <Muted>{tr('family.attendance')} · <T ltr style={{ color: color.ink2, fontSize: 14 }}>{days.length ? `${present}/${days.length}` : '—'}</T></Muted>
                    <Bar value={rate} tint={rate >= 0.9 ? color.ok : rate >= 0.75 ? color.accent : color.danger} />
                  </Card>
                );
              })}
              {kids?.length === 0 && !err ? <Empty icon="people-outline" text={tr('ui.empty')} /> : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
