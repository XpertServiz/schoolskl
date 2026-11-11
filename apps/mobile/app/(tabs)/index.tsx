import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Bar, Card, Chip, color, Empty, ErrorText, gradient, H1, H2, Loading, Muted, Screen, T, Tile } from '@/lib/ui';

interface Child { id: string; full_name: string; admission_no: string }
interface Att { student_id: string; status: string }

const greetingKey = () => { const h = new Date().getHours(); return h < 12 ? 'mobile.home.morning' : h < 17 ? 'mobile.home.afternoon' : 'mobile.home.evening'; };

/**
 * Home: a greeting, quick actions for what this person may do, and (for a parent) each child with the last 30 days of attendance.
 * RLS returns only this guardian's own children; staff see their quick actions only.
 */
export default function Home() {
  const { tr, access, can, rtl } = useApp();
  const router = useRouter();
  const [kids, setKids] = useState<Child[] | null>(null);
  const [att, setAtt] = useState<Att[]>([]);
  const [me, setMe] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const guardian = !!access?.is_guardian;
  const saferoute = (access?.flags ?? []).includes('saferoute');

  const load = useCallback(async () => {
    setErr(null);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data: u } = await supabase.auth.getUser();
    const [c, a, p] = await Promise.all([
      guardian ? supabase.from('students').select('id, full_name, admission_no').order('full_name') : Promise.resolve({ data: [], error: null }),
      guardian ? supabase.from('student_attendance').select('student_id, status').gte('att_date', since) : Promise.resolve({ data: [], error: null }),
      u.user ? supabase.from('profiles').select('full_name').eq('user_id', u.user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (c.error) setErr(c.error.message);
    setKids((c.data ?? []) as Child[]);
    setAtt((a.data ?? []) as Att[]);
    setMe(((p.data as { full_name?: string } | null)?.full_name ?? '').split(' ')[0] ?? '');
  }, [guardian]);
  useEffect(() => { void load(); }, [load]);

  const go = (path: string) => router.push(path as never);
  const tiles = [
    guardian && { icon: 'wallet-outline' as const, label: tr('nav.fees'), tint: color.ok, path: '/fees' },
    guardian && { icon: 'school-outline' as const, label: tr('family.results'), tint: color.violet, path: '/results' },
    guardian && saferoute && { icon: 'bus-outline' as const, label: tr('transport.family.bus'), tint: color.accent, path: '/bus' },
    can('attendance.mark') && { icon: 'checkbox-outline' as const, label: tr('nav.attendance'), tint: color.info, path: '/attendance' },
    (access?.is_crew || can('transport.manage')) && saferoute && { icon: 'navigate-outline' as const, label: tr('transport.drive.title'), tint: color.accent, path: '/drive' },
    { icon: 'person-circle-outline' as const, label: tr('mobile.tab.more'), tint: color.ink2, path: '/more' },
  ].filter(Boolean) as { icon: 'wallet-outline'; label: string; tint: string; path: string }[];

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
