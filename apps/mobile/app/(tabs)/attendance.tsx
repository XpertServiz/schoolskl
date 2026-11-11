import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, View } from 'react-native';
import { attendanceKey, flushQueue, queue, type AttendanceOp } from '@/lib/queue';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, color, ErrorText, Loading, Muted, s, T } from '@/lib/ui';

interface Section { id: string; name: string; class_id: string }
interface Kid { id: string; full_name: string }
type Status = 'present' | 'absent' | 'late' | 'leave';
const NEXT: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'leave', leave: 'present' };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The register works with no signal. The class list is cached the last time it loaded; a saved register goes into the offline queue
 * (latest state per class+day wins) and is sent when the phone is online. Everyone defaults to present; tap a child to cycle
 * present → absent → late → leave. The server still enforces permission, day lock and "not in the future".
 */
export default function Attendance() {
  const { tr } = useApp();
  const [sections, setSections] = useState<Section[]>([]);
  const [classes, setClasses] = useState<Record<string, string>>({});
  const [section, setSection] = useState<Section | null>(null);
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    setPending(await queue.size());
    setFailed((await queue.failed()).map((f) => f.reason));
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await AsyncStorage.getItem('school.sections');
      if (cached) { const c = JSON.parse(cached) as { sections: Section[]; classes: Record<string, string> }; setSections(c.sections); setClasses(c.classes); }
      const [sec, cls] = await Promise.all([supabase.from('sections').select('id, name, class_id').order('name'), supabase.from('classes').select('id, name')]);
      if (!sec.error && !cls.error) {
        const cm = Object.fromEntries((cls.data ?? []).map((c) => [c.id as string, c.name as string]));
        setSections((sec.data ?? []) as Section[]); setClasses(cm);
        await AsyncStorage.setItem('school.sections', JSON.stringify({ sections: sec.data, classes: cm }));
      }
      await refreshCounts();
    })();
  }, [refreshCounts]);

  async function open(sec: Section) {
    setSection(sec); setKids(null); setErr(null); setMsg(null);
    const cacheKey = `school.roster.${sec.id}`;
    let list: Kid[] | null = null;
    const en = await supabase.from('student_enrolments').select('student_id, roll_no').eq('section_id', sec.id).eq('status', 'active').order('roll_no');
    if (!en.error) {
      const ids = (en.data ?? []).map((e) => e.student_id as string);
      const st = ids.length ? await supabase.from('students').select('id, full_name').in('id', ids) : { data: [] as Kid[], error: null };
      if (!st.error) {
        const byId = new Map((st.data ?? []).map((k) => [k.id as string, k as Kid]));
        list = ids.map((id) => byId.get(id)).filter((k): k is Kid => !!k);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(list));
      }
    }
    if (!list) { // offline: use the last roster this phone saw
      const c = await AsyncStorage.getItem(cacheKey);
      list = c ? (JSON.parse(c) as Kid[]) : [];
      if (!c) setErr(tr('mobile.att.noRoster'));
    }
    setKids(list);
    setStatus(Object.fromEntries(list.map((k) => [k.id, 'present' as Status]))); // all-present default
  }

  async function save() {
    if (!section || !kids) return;
    const ids = (st: Status) => kids.filter((k) => status[k.id] === st).map((k) => k.id);
    const op: AttendanceOp = { section: section.id, date: today(), absent: ids('absent'), late: ids('late'), leave: ids('leave') };
    await queue.enqueue('attendance.mark', op, { dedupeKey: attendanceKey(section.id, op.date) }); // persisted before we say "saved"
    setMsg(tr('mobile.att.queued'));
    const r = await flushQueue();
    if (r.remaining === 0) setMsg(tr('attendance.saved'));
    await refreshCounts();
  }

  const label: Record<Status, string> = { present: tr('cockpit.present'), absent: tr('cockpit.absent'), late: tr('attendance.late'), leave: tr('attendance.leave') };
  const tint: Record<Status, string> = { present: color.ok, absent: color.danger, late: color.accent, leave: color.ink2 };

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        {pending > 0 ? <Card><T>{tr('mobile.att.waiting', { count: pending })}</T><Button secondary label={tr('mobile.att.syncNow')} onPress={async () => { await flushQueue(); await refreshCounts(); }} /></Card> : null}
        {failed.length > 0 ? (
          <Card>
            {failed.map((f, i) => <ErrorText key={i}>{f}</ErrorText>)}
            <Button secondary label={tr('mobile.att.dismiss')} onPress={async () => { await queue.dismissFailed(); await refreshCounts(); }} />
          </Card>
        ) : null}

        {!section ? (
          <>
            <T style={{ fontSize: 22, fontWeight: '700' }}>{tr('attendance.section')}</T>
            {sections.map((x) => <Button key={x.id} secondary label={`${classes[x.class_id] ?? ''} · ${x.name}`} onPress={() => void open(x)} />)}
          </>
        ) : (
          <>
            <T style={{ fontSize: 22, fontWeight: '700' }}>{classes[section.class_id]} · {section.name}</T>
            <Muted ltr>{today()}</Muted>
            <Muted>{tr('mobile.att.hint')}</Muted>
            {kids === null ? <Loading /> : null}
            {err ? <ErrorText>{err}</ErrorText> : null}
            {(kids ?? []).map((k) => (
              <Pressable key={k.id} accessibilityRole="button" accessibilityLabel={`${k.full_name}: ${label[status[k.id] ?? 'present']}`} onPress={() => setStatus((p) => ({ ...p, [k.id]: NEXT[p[k.id] ?? 'present'] }))}>
                <View style={[s.card, s.row, { borderColor: tint[status[k.id] ?? 'present'] }]}>
                  <T>{k.full_name}</T>
                  <T style={{ color: tint[status[k.id] ?? 'present'], fontWeight: '700' }}>{label[status[k.id] ?? 'present']}</T>
                </View>
              </Pressable>
            ))}
            {msg ? <T style={{ color: color.ok }} accessibilityRole="alert">{msg}</T> : null}
            {kids && kids.length > 0 ? <Button label={tr('attendance.save')} onPress={() => void save()} /> : null}
            <Button secondary label={tr('ui.back')} onPress={() => { setSection(null); setKids(null); }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
