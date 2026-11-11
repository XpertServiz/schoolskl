import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Card, Chip, color, Empty, ErrorText, Field, Header, Loading, Muted, Screen, T } from '@/lib/ui';

interface Due { voucher_id: string; student_id: string; voucher_no: string; due_date: string; balance_minor: number; days_overdue: number }

/** Unpaid fee vouchers, oldest first, with who owes what and how late. Recording a payment stays on the website (cash drawer, receipts). */
export default function Dues() {
  const { tr, fmt, rtl } = useApp();
  const [rows, setRows] = useState<Due[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      supabase.from('v_fee_aging').select('voucher_id, student_id, voucher_no, due_date, balance_minor, days_overdue').gt('balance_minor', 0).order('due_date').limit(300),
      supabase.from('students').select('id, full_name'),
    ]);
    if (d.error) { setErr(d.error.message); return; }
    setErr(null);
    setRows((d.data ?? []) as Due[]);
    setNames(Object.fromEntries((s.data ?? []).map((x) => [x.id as string, x.full_name as string])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !k || (names[r.student_id] ?? '').toLowerCase().includes(k) || r.voucher_no.toLowerCase().includes(k));
  }, [rows, names, q]);
  const total = shown.reduce((a, r) => a + Number(r.balance_minor), 0);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('ma.dues.title')} />
        {rows ? <Card accent><Muted>{tr('ma.dues.total')}</Muted><T ltr style={{ fontSize: 30, fontWeight: '900' }}>{fmt(total)}</T></Card> : null}
        <Field label={tr('common.search')} icon="search-outline" value={q} onChangeText={setQ} placeholder={tr('ma.dues.search')} autoCapitalize="none" />
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows && shown.length === 0 ? <Empty icon="checkmark-done-outline" text={tr('ma.dues.none')} /> : null}
        {shown.map((r) => (
          <Card key={r.voucher_id}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800' }}>{names[r.student_id] ?? '—'}</T><Muted ltr>{r.voucher_no} · {r.due_date}</Muted></View>
              <T ltr style={{ fontWeight: '900', fontSize: 18 }}>{fmt(r.balance_minor)}</T>
            </View>
            <Chip label={r.days_overdue > 0 ? tr('ma.dues.late', { n: r.days_overdue }) : tr('ma.dues.onTime')} tint={r.days_overdue > 30 ? color.danger : r.days_overdue > 0 ? color.accent : color.ok} />
          </Card>
        ))}
        <Muted style={{ textAlign: 'center' }}>{tr('ma.dues.web')}</Muted>
      </ScrollView>
    </Screen>
  );
}
