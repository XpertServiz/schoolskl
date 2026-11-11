import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Loading, Muted, color, s, Screen, T } from '@/lib/ui';

interface Route { route_id: string; name: string; vehicle_label: string | null; riders: number; open_trip_id: string | null; open_direction: string | null; saferoute_on: boolean }
interface Rider { student_id: string; first_name: string; stop_name: string | null; consent: boolean; state: 'boarded' | 'alighted' | null }
interface Point { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; at: string }
type Scan = { result: string; name?: string };

const KEEP_AWAKE = 'saferoute-trip';
const ptsKey = (trip: string) => `saferoute:points:${trip}`;

/**
 * The driver / attendant screen. Free by design: the crew's own phone is the bus tracker and children carry printed QR cards.
 *   * location is FOREGROUND only, and only while a trip is running (DECISION: no background-location permission — Play Store review and
 *     battery; the screen is kept awake instead, so keep the phone on the dashboard holder and charging);
 *   * positions are buffered on the phone and sent in batches, so a dead zone on the route loses nothing;
 *   * every scan is checked by the database (scan_transport_card): wrong bus, no parent consent and unknown cards are shown, not recorded.
 */
export default function Drive() {
  const { tr } = useApp();
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [trip, setTrip] = useState<{ id: string; route: Route; direction: string } | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState(0);
  const [scanOpen, setScanOpen] = useState(false);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cam, askCam] = useCameraPermissions();
  const buffer = useRef<Point[]>([]);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const loadRoutes = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_transport_routes');
    if (error) { setErr(error.message); return; }
    const list = (data ?? []) as Route[];
    setRoutes(list);
    const open = list.find((r) => r.open_trip_id);
    if (open && !trip) setTrip({ id: open.open_trip_id!, route: open, direction: open.open_direction ?? 'to_school' });
  }, [trip]);

  const loadRiders = useCallback(async (id: string) => {
    const { data, error } = await supabase.rpc('trip_riders', { p_trip: id });
    if (!error) setRiders((data ?? []) as Rider[]);
  }, []);

  useEffect(() => { void loadRoutes(); }, [loadRoutes]);

  // ---- positions: buffer → AsyncStorage → server, every 15 s
  const flush = useCallback(async (id: string) => {
    if (buffer.current.length === 0) return;
    const batch = buffer.current.slice(0, 500);
    const { error } = await supabase.rpc('post_trip_positions', { p_trip: id, p_points: batch });
    if (!error) buffer.current = buffer.current.slice(batch.length);
    else if (/trip has ended/.test(error.message)) buffer.current = [];
    await AsyncStorage.setItem(ptsKey(id), JSON.stringify(buffer.current.slice(-2000)));
    setPending(buffer.current.length);
  }, []);

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    (async () => {
      const saved = await AsyncStorage.getItem(ptsKey(trip.id));
      if (saved) buffer.current = [...(JSON.parse(saved) as Point[]), ...buffer.current];
      await loadRiders(trip.id);
      // keep the screen on if the phone allows it; if it refuses, location sharing must still start
      await activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setErr(tr('transport.drive.permission')); return; }
      if (cancelled) return;
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 15 },
        (loc) => {
          buffer.current.push({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null,
            speed: loc.coords.speed ?? null, heading: loc.coords.heading ?? null, at: new Date(loc.timestamp).toISOString() });
          setPending(buffer.current.length);
        },
      );
      setSharing(true);
    })();
    const timer = setInterval(() => void flush(trip.id), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      try { watch.current?.remove(); } catch { /* expo-location on web throws here; the watch is gone either way */ }
      watch.current = null;
      setSharing(false);
      Promise.resolve().then(() => deactivateKeepAwake(KEEP_AWAKE)).catch(() => { /* was never active */ });
    };
  }, [trip, flush, loadRiders, tr]);

  const start = async (r: Route, direction: 'to_school' | 'to_home') => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('start_trip', { p_route: r.route_id, p_direction: direction });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setTrip({ id: data as string, route: r, direction });
  };

  const end = async () => {
    if (!trip) return;
    setBusy(true);
    await flush(trip.id);
    const { data, error } = await supabase.rpc('end_trip', { p_trip: trip.id });
    setBusy(false);
    if (error && !/trip has ended/.test(error.message)) { setErr(error.message); return; }
    const still = (data as { still_on_board?: number } | null)?.still_on_board ?? 0;
    setLast(still > 0 ? { text: tr('transport.drive.stillOnBoard', { n: still }), ok: false } : null);
    await AsyncStorage.removeItem(ptsKey(trip.id));
    buffer.current = []; setPending(0); setTrip(null); setRiders([]);
    await loadRoutes();
  };

  const show = (r: Scan) => {
    const ok = r.result === 'boarded' || r.result === 'alighted';
    setLast({ text: tr(`transport.drive.result.${r.result}`, { name: r.name ?? '' }), ok });
  };

  const onScan = async (code: string) => {
    if (!trip) return;
    const now = Date.now();
    if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < 4000) return; // camera fires many times per card
    lastCode.current = { code, at: now };
    const { data, error } = await supabase.rpc('scan_transport_card', { p_trip: trip.id, p_code: code });
    if (error) { setLast({ text: error.message, ok: false }); return; }
    show(data as Scan);
    void loadRiders(trip.id);
  };

  const mark = async (student: string, kind: 'boarded' | 'alighted') => {
    if (!trip) return;
    const { data, error } = await supabase.rpc('mark_rider', { p_trip: trip.id, p_student: student, p_kind: kind });
    if (error) { setLast({ text: error.message, ok: false }); return; }
    show(data as Scan);
    void loadRiders(trip.id);
  };

  const openScanner = async () => {
    if (!cam?.granted) { const r = await askCam(); if (!r.granted) { setErr(tr('transport.drive.cameraPermission')); return; } }
    setScanOpen(true);
  };

  if (routes === null && !err) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.pad}>
        {err ? <ErrorText>{err}</ErrorText> : null}
        {last ? <Card><T style={{ color: last.ok ? color.ok : color.danger, fontWeight: '700', fontSize: 18 }}>{last.text}</T></Card> : null}

        {!trip ? (
          <>
            <T style={{ fontWeight: '700', fontSize: 18 }}>{tr('transport.drive.pick')}</T>
            {routes?.length === 0 ? <Muted>{tr('transport.notCrew')}</Muted> : null}
            {(routes ?? []).map((r) => (
              <Card key={r.route_id}>
                <T style={{ fontWeight: '700' }}>{r.name}</T>
                <Muted>{r.vehicle_label ?? ''} · {r.riders}</Muted>
                {!r.saferoute_on ? <Muted>{tr('transport.off')}</Muted> : (
                  <>
                    <Button label={`${tr('transport.drive.start')} — ${tr('transport.dir.to_school')}`} disabled={busy} onPress={() => void start(r, 'to_school')} />
                    <Button secondary label={`${tr('transport.drive.start')} — ${tr('transport.dir.to_home')}`} disabled={busy} onPress={() => void start(r, 'to_home')} />
                  </>
                )}
              </Card>
            ))}
          </>
        ) : (
          <>
            <Card>
              <T style={{ fontWeight: '700', fontSize: 18 }}>{trip.route.name} · {tr(`transport.dir.${trip.direction}`)}</T>
              <T style={{ color: sharing ? color.ok : color.danger }}>{sharing ? `● ${tr('transport.drive.sharing')}` : tr('transport.drive.notSharing')}</T>
              {pending > 0 ? <Muted>{tr('transport.drive.pending', { n: pending })}</Muted> : null}
              <Muted>{tr('transport.drive.keepOpen')}</Muted>
            </Card>
            <Button label={tr('transport.drive.scan')} onPress={() => void openScanner()} />
            <T style={{ fontWeight: '700' }}>{tr('transport.drive.list')}</T>
            {riders.map((r) => (
              <Card key={r.student_id}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: '700' }}>{r.first_name} {r.state === 'boarded' ? '🟢' : r.state === 'alighted' ? '⚪' : ''}</T>
                    <Muted>{r.stop_name ?? ''}{r.consent ? '' : ` · ${tr('transport.drive.result.no_consent', { name: '' })}`}</Muted>
                  </View>
                  {r.consent ? (
                    <Pressable accessibilityRole="button" onPress={() => void mark(r.student_id, r.state === 'boarded' ? 'alighted' : 'boarded')}
                      style={[s.btn, s.btnSecondary, { paddingHorizontal: 14 }]}>
                      <T>{r.state === 'boarded' ? tr('transport.drive.alight') : tr('transport.drive.board')}</T>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            ))}
            <Button secondary label={tr('transport.drive.end')} disabled={busy} onPress={() => void end()} />
          </>
        )}
      </ScrollView>

      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <SafeAreaView style={[s.screen, { padding: 16, gap: 12 }]}>
          <T style={{ fontWeight: '700', fontSize: 18 }}>{tr('transport.drive.scanHint')}</T>
          <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(e) => void onScan(e.data)} />
          </View>
          {last ? <T style={{ color: last.ok ? color.ok : color.danger, fontWeight: '700', fontSize: 20, textAlign: 'center' }}>{last.text}</T> : null}
          <Button secondary label={tr('transport.drive.close')} onPress={() => setScanOpen(false)} />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
