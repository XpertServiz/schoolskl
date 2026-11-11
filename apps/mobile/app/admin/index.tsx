import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Card, Chip, color, Empty, ErrorText, H2, Header, Loading, Muted, Screen, T } from '@/lib/ui';

export interface School { tenant_id: string; slug: string; name: string; status: string; plan_key: string | null; students: number; staff: number; members: number }

/** Super-admin Dashboard: platform numbers and every school (counts only — school records stay private). */
export default function AdminHome() {
  const { tr, rtl } = useApp();
  const [schools, setSchools] = useState<School[] | null>(null);
  const [visits, setVisits] = useState(0);
  const [leads, setLeads] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const [o, v, l] = await Promise.all([
      supabase.rpc('vendor_overview'),
      supabase.from('site_visits').select('visits').gte('day', since),
      supabase.from('demo_requests').select('id', { count: 'exact', head: true }).is('handled_at', null),
    ]);
    if (o.error) { setErr(o.error.message); return; }
    setErr(null);
    setSchools((o.data ?? []) as School[]);
    setVisits((v.data ?? []).reduce((a, r) => a + Number((r as { visits: number }).visits), 0));
    setLeads(l.count ?? 0);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sum = (k: 'students' | 'staff') => (schools ?? []).reduce((a, s) => a + s[k], 0);
  const kpi = (label: string, value: number, tint: string = color.ink) => (
    <Card key={label} style={{ flexBasis: '47%', flexGrow: 1 }}><Muted>{label}</Muted><T ltr style={{ fontSize: 28, fontWeight: '900', color: tint }}>{value}</T></Card>
  );
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header eyebrow={tr('ma.admin.role')} title={tr('vx.dash.title')} />
        {schools === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {schools ? (
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 12 }}>
            {kpi(tr('vx.dash.schools'), schools.length, color.accent)}{kpi(tr('vx.dash.students'), sum('students'))}
            {kpi(tr('vx.dash.staff'), sum('staff'))}{kpi(tr('vx.dash.visits7'), visits, color.info)}{kpi(tr('vx.dash.leads'), leads, leads > 0 ? color.accent : color.ok)}
          </View>
        ) : null}
        <H2>{tr('vx.dash.perSchool')}</H2>
        {schools?.length === 0 ? <Empty icon="school-outline" text={tr('vx.dash.none')} /> : null}
        {(schools ?? []).map((s) => (
          <Card key={s.tenant_id}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={s.name} size={44} />
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800' }}>{s.name}</T><Muted ltr>{s.slug} · {s.plan_key ?? '—'}</Muted></View>
              <Chip label={s.status} tint={s.status === 'live' ? color.ok : color.accent} />
            </View>
            <Muted>{tr('vx.dash.students')}: {s.students} · {tr('vx.dash.staff')}: {s.staff} · {tr('vx.dash.people')}: {s.members}</Muted>
          </Card>
        ))}
        <Muted style={{ textAlign: 'center' }}>{tr('ma.admin.web')}</Muted>
      </ScrollView>
    </Screen>
  );
}
