import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, Chip, color, Empty, ErrorText, Header, Loading, Muted, Notice, Screen, T } from '@/lib/ui';

interface Item { kind: string; ref_id: string; title: string; detail: string | null; amount_minor: number | null; requested_at: string; can_act: boolean; blocked_reason: string | null }

/**
 * Things waiting for this person: discounts, payroll, results. Every button calls the same database function as the website, so the
 * database still refuses what this person may not do (maker-checker: you cannot approve your own request; money keys need 2FA).
 */
export default function Approvals() {
  const { tr, fmt } = useApp();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('approvals_inbox');
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Item[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(it: Item, approve: boolean) {
    setBusy(it.ref_id); setErr(null); setMsg(null);
    const { error } = it.kind === 'concession' ? await supabase.rpc('approve_concession', { p_id: it.ref_id, p_approve: approve })
      : it.kind === 'payroll' ? await supabase.rpc('post_payroll', { p_run: it.ref_id })
      : it.kind === 'results' ? await supabase.rpc('publish_results', { p_exam: it.ref_id })
      : { error: { message: 'unknown' } };
    setBusy(null);
    if (error) setErr(error.message); else { setMsg(tr('ma.appr.done')); await load(); }
  }

  const actionable = (k: string) => k === 'concession' || k === 'payroll' || k === 'results';
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('nav.approvals')} />
        {msg ? <Notice>{msg}</Notice> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows === null && !err ? <Loading /> : null}
        {rows?.length === 0 ? <Empty icon="checkmark-done-outline" text={tr('ma.appr.none')} /> : null}
        {(rows ?? []).map((it) => (
          <Card key={`${it.kind}-${it.ref_id}`}>
            <Chip label={it.kind} />
            <T style={{ fontWeight: '800', fontSize: 17 }}>{it.title}</T>
            {it.detail ? <Muted>{it.detail}</Muted> : null}
            {it.amount_minor != null ? <T ltr style={{ fontWeight: '900', fontSize: 20 }}>{fmt(it.amount_minor)}</T> : null}
            {actionable(it.kind) && it.can_act ? (
              <View style={{ gap: 8 }}>
                <Button icon="checkmark-circle-outline" label={tr('ma.appr.approve')} disabled={busy === it.ref_id} onPress={() => void decide(it, true)} />
                {it.kind === 'concession' ? <Button secondary danger icon="close-circle-outline" label={tr('ma.appr.reject')} disabled={busy === it.ref_id} onPress={() => void decide(it, false)} /> : null}
              </View>
            ) : <Muted>{it.blocked_reason ?? tr('ma.appr.blocked')}</Muted>}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
