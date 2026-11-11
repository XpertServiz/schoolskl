import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, SafeAreaView, ScrollView } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Card, ErrorText, Loading, Muted, s, T } from '@/lib/ui';

interface Child { id: string; full_name: string; admission_no: string }
interface Att { student_id: string; status: string }

/** Parent home: each child with the last 30 days of attendance. RLS returns only this guardian's own children. */
export default function Home() {
  const { tr, access } = useApp();
  const [kids, setKids] = useState<Child[] | null>(null);
  const [att, setAtt] = useState<Att[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [c, a] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_no').order('full_name'),
      supabase.from('student_attendance').select('student_id, status').gte('att_date', since),
    ]);
    if (c.error) setErr(c.error.message);
    setKids((c.data ?? []) as Child[]);
    setAtt((a.data ?? []) as Att[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#F5A524" />}>
        <T style={{ fontSize: 24, fontWeight: '700' }}>{access?.tenant.name}</T>
        {kids === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {(kids ?? []).map((k) => {
          const days = att.filter((x) => x.student_id === k.id);
          const present = days.filter((x) => x.status === 'present' || x.status === 'late').length;
          return (
            <Card key={k.id}>
              <T style={{ fontWeight: '700', fontSize: 18 }}>{k.full_name}</T>
              <Muted ltr>{k.admission_no}</Muted>
              <T>{tr('family.attendance')}: <T ltr>{days.length ? `${present}/${days.length}` : '—'}</T></T>
            </Card>
          );
        })}
        {kids?.length === 0 && !err ? <Muted>{tr('ui.empty')}</Muted> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
