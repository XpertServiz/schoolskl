import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Avatar, Card, Chip, color, Empty, ErrorText, Field, Header, Loading, Muted, Screen, T } from '@/lib/ui';

interface Row { id: string; full_name: string; admission_no: string; status: string }

/** Everyone enrolled, searchable. The database decides what this login may see (students.view); a parent never reaches this tab. */
export default function Students() {
  const { tr, rtl } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('students').select('id, full_name, admission_no, status').order('full_name').limit(1000);
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Row[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !k || r.full_name.toLowerCase().includes(k) || r.admission_no.toLowerCase().includes(k));
  }, [rows, q]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('nav.students')} subtitle={rows ? tr('ma.students.count', { n: shown.length }) : undefined} />
        <Field label={tr('common.search')} icon="search-outline" value={q} onChangeText={setQ} placeholder={tr('ma.students.search')} autoCapitalize="none" />
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows && shown.length === 0 ? <Empty icon="people-outline" text={tr('ma.students.none')} /> : null}
        {shown.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={r.full_name} size={42} />
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800' }}>{r.full_name}</T><Muted ltr>{r.admission_no}</Muted></View>
              {r.status !== 'enrolled' ? <Chip label={r.status} tint={color.ink2} /> : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
