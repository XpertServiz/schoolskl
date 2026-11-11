import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Bar, Card, color, Empty, ErrorText, H2, Header, Loading, Muted, Screen, T } from '@/lib/ui';

interface Row { day: string; path: string; lang: string; visits: number; views: number }
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Website visitors (privacy-friendly daily counter: no cookies, no IPs). Visits = first page of a session; views = every page. */
export default function Visitors() {
  const { tr, rtl } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const from = iso(new Date(Date.now() - 29 * 864e5));
    const { data, error } = await supabase.from('site_visits').select('day, path, lang, visits, views').gte('day', from);
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Row[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = rows ?? [];
  const today = iso(new Date()), from7 = iso(new Date(Date.now() - 6 * 864e5));
  const tot = (f: (r: Row) => boolean) => all.filter(f).reduce((a, r) => ({ visits: a.visits + r.visits, views: a.views + r.views }), { visits: 0, views: 0 });
  const periods: [string, { visits: number; views: number }][] = [[tr('vx.visitors.today'), tot((r) => r.day === today)], [tr('vx.visitors.week'), tot((r) => r.day >= from7)], [tr('vx.visitors.month'), tot(() => true)]];
  const days = [...Array(7)].map((_, i) => iso(new Date(Date.now() - i * 864e5)));
  const byDay = (d: string) => all.filter((r) => r.day === d).reduce((a, r) => a + r.views, 0);
  const peak = Math.max(1, ...days.map(byDay));
  const pages = new Map<string, number>(); all.forEach((r) => pages.set(r.path, (pages.get(r.path) ?? 0) + r.views));
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('vx.visitors.title')} />
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows ? (
          <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 12 }}>
            {periods.map(([label, v]) => (
              <Card key={label} style={{ flexBasis: '47%', flexGrow: 1 }}><Muted>{label}</Muted><T ltr style={{ fontSize: 28, fontWeight: '900' }}>{v.visits}</T><Muted>{tr('vx.visitors.visits')} · {v.views} {tr('vx.visitors.views')}</Muted></Card>
            ))}
          </View>
        ) : null}
        {rows?.length === 0 ? <Empty icon="stats-chart-outline" text={tr('vx.visitors.empty')} /> : null}
        {rows && rows.length > 0 ? (
          <>
            <H2>{tr('vx.visitors.byDay')}</H2>
            <Card>{days.map((d) => (<View key={d} style={{ gap: 4 }}><Muted ltr>{d} · {byDay(d)}</Muted><Bar value={byDay(d) / peak} tint={color.accent} /></View>))}</Card>
            <H2>{tr('vx.visitors.topPages')}</H2>
            <Card>{[...pages.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => (<View key={p} style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between' }}><T ltr>{p}</T><T ltr style={{ fontWeight: '800' }}>{n}</T></View>))}</Card>
          </>
        ) : null}
        <Muted>{tr('vx.visitors.note')}</Muted>
      </ScrollView>
    </Screen>
  );
}
