import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, Chip, color, Empty, ErrorText, Header, Loading, Muted, Screen, T } from '@/lib/ui';

interface Lead { id: string; full_name: string; school_name: string; city: string | null; phone: string; email: string | null; students_band: string | null; message: string | null; created_at: string; handled_at: string | null }
const BAND: Record<string, string> = { lt300: '< 300', '300_1000': '300–1,000', '1000_3000': '1,000–3,000', gt3000: '3,000+' };
/** 03001234567 / +923001234567 → 923001234567 (what wa.me wants) */
const waDigits = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? `92${d.slice(1)}` : d; };

/** Demo requests from the website's "Book a demo" form: call or WhatsApp the school straight from here, then mark it handled. */
export default function Leads() {
  const { tr, rtl } = useApp();
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('demo_requests').select('id, full_name, school_name, city, phone, email, students_band, message, created_at, handled_at').order('created_at', { ascending: false }).limit(100);
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Lead[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function handled(id: string) {
    const { data: u } = await supabase.auth.getSession();
    const { error } = await supabase.from('demo_requests').update({ handled_at: new Date().toISOString(), handled_by: u.session?.user.id }).eq('id', id);
    if (error) setErr(error.message); else await load();
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={color.accent} />}>
        <Header title={tr('vendor.leads')} />
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows?.length === 0 ? <Empty icon="chatbubbles-outline" text={tr('ma.leads.none')} /> : null}
        {(rows ?? []).map((l) => (
          <Card key={l.id} accent={!l.handled_at}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}><T style={{ fontWeight: '800', fontSize: 17 }}>{l.school_name}</T><Muted>{l.full_name}{l.city ? ` · ${l.city}` : ''}</Muted></View>
              <Chip label={l.handled_at ? tr('vendor.handled') : tr('ma.leads.new')} tint={l.handled_at ? color.ok : color.accent} />
            </View>
            <Muted ltr>{l.phone}{l.email ? ` · ${l.email}` : ''}{l.students_band ? ` · ${BAND[l.students_band] ?? ''}` : ''} · {l.created_at.slice(0, 10)}</Muted>
            {l.message ? <T>{l.message}</T> : null}
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button secondary icon="call-outline" label={tr('ma.leads.call')} onPress={() => void Linking.openURL(`tel:${l.phone}`)} /></View>
              <View style={{ flex: 1 }}><Button secondary icon="logo-whatsapp" label={tr('ma.leads.wa')} onPress={() => void Linking.openURL(`https://wa.me/${waDigits(l.phone)}`)} /></View>
            </View>
            {!l.handled_at ? <Button icon="checkmark-circle-outline" label={tr('vendor.markHandled')} onPress={() => void handled(l.id)} /> : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
