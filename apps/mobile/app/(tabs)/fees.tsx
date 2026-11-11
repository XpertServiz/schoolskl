import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, SafeAreaView, ScrollView } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Loading, Muted, s, T } from '@/lib/ui';

interface V { id: string; student_id: string; voucher_no: string; consumer_no: string; due_date: string; status: string; total_minor: number; adjusted_minor: number; paid_minor: number }

/**
 * Fee vouchers for this family. Payment happens at the bank / in a banking app / through 1Bill using the consumer number — there is no
 * in-app payment until a gateway partner is signed (open question 4), so the app never asks for card or account details.
 */
export default function Fees() {
  const { tr, fmt } = useApp();
  const [rows, setRows] = useState<V[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const [v, st] = await Promise.all([
      supabase.from('vouchers').select('id, student_id, voucher_no, consumer_no, due_date, status, total_minor, adjusted_minor, paid_minor').neq('status', 'cancelled').order('period', { ascending: false }).limit(60),
      supabase.from('students').select('id, full_name'),
    ]);
    if (v.error) setErr(v.error.message);
    setRows((v.data ?? []) as V[]);
    setNames(Object.fromEntries((st.data ?? []).map((x) => [x.id as string, x.full_name as string])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#F5A524" />}>
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows?.length === 0 ? <Muted>{tr('family.noFees')}</Muted> : null}
        {(rows ?? []).map((v) => {
          const bal = Number(v.total_minor) + Number(v.adjusted_minor) - Number(v.paid_minor);
          return (
            <Card key={v.id}>
              <T style={{ fontWeight: '700' }}>{names[v.student_id] ?? ''}</T>
              <Muted ltr>{v.voucher_no} · {tr('ui.due')} {v.due_date}</Muted>
              <T ltr style={{ fontSize: 22, fontWeight: '700' }}>{bal > 0 ? fmt(bal) : tr('ui.paid')}</T>
              {bal > 0 ? (
                <>
                  <Muted>{tr('mobile.fees.payWith')}</Muted>
                  <T ltr style={{ fontSize: 20, letterSpacing: 1 }} selectable>{v.consumer_no}</T>
                  <Button secondary label={copied === v.id ? tr('mobile.fees.copied') : tr('mobile.fees.copy')} onPress={async () => { await Clipboard.setStringAsync(v.consumer_no); setCopied(v.id); }} />
                </>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
