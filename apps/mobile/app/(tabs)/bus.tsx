import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { BusMap } from '@/lib/busmap';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Loading, Muted, s, T, Screen } from '@/lib/ui';

interface Bus {
  student_id: string; first_name: string; route_name: string; vehicle_label: string | null; stop_name: string | null;
  consent: boolean; saferoute_on: boolean; trip_id: string | null; direction: string | null;
  last_event: 'boarded' | 'alighted' | null; last_event_at: string | null; lat: number | null; lng: number | null; position_at: string | null;
}

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? '< 1 min' : `${m} min`;
};

/**
 * The parent's school-bus screen. Everything comes from my_bus_status(): only the caller's own children, only after the caller consented,
 * and the bus position disappears once the child is off the bus. Refreshes every 15 s while the screen is open.
 */
export default function BusScreen() {
  const { tr } = useApp();
  const [rows, setRows] = useState<Bus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_bus_status');
    if (error) setErr(error.message); else { setErr(null); setRows((data ?? []) as Bus[]); }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]));

  const consent = async (student: string, granted: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc('set_transport_consent', { p_student: student, p_granted: granted });
    if (error) setErr(error.message);
    await load();
    setBusy(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#F5A524" />}>
        {rows === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {rows?.length === 0 ? <Muted>{tr('ui.empty')}</Muted> : null}
        {(rows ?? []).map((b) => (
          <Card key={b.student_id}>
            <T style={{ fontWeight: '700', fontSize: 18 }}>{b.first_name}</T>
            <Muted>{b.route_name}{b.vehicle_label ? ` · ${b.vehicle_label}` : ''}{b.stop_name ? ` · ${b.stop_name}` : ''}</Muted>
            {!b.saferoute_on ? <Muted>{tr('transport.off')}</Muted> : !b.consent ? (
              <>
                <T>{tr('transport.family.consentQ', { name: b.first_name })}</T>
                <Muted>{tr('transport.family.consentOff', { name: b.first_name })}</Muted>
                <Button label={tr('transport.family.give')} disabled={busy} onPress={() => void consent(b.student_id, true)} />
              </>
            ) : (
              <>
                {!b.trip_id ? <Muted>{tr('transport.family.noTrip')}</Muted> : (
                  <>
                    <T style={{ fontWeight: '700' }}>{tr(`transport.dir.${b.direction}`)}</T>
                    <T>{b.last_event ? tr(`transport.family.${b.last_event}`, { name: b.first_name, time: hhmm(b.last_event_at) }) : tr('transport.family.onTheWay')}</T>
                    {b.lat != null && b.lng != null ? (
                      <>
                        <Muted>{tr('transport.updated', { time: ago(b.position_at) })}</Muted>
                        <BusMap lat={b.lat} lng={b.lng} label={b.route_name} />
                      </>
                    ) : <Muted>{b.last_event === 'alighted' ? tr('transport.family.hidden') : tr('transport.noFix')}</Muted>}
                  </>
                )}
                <Muted>{tr('transport.family.consentOn')}</Muted>
                <Button secondary label={tr('transport.family.withdraw')} disabled={busy} onPress={() => void consent(b.student_id, false)} />
              </>
            )}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
