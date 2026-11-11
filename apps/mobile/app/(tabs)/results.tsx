import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorText, Loading, Muted, s, T, Screen } from '@/lib/ui';

interface Sum { exam_id: string; student_id: string; percent: number; grade: string | null; position: number }
interface Card_ { student: { name: string }; exam: { name: string }; lines: { subject: string; marks: number | null; max_marks: number; grade: string | null; status: string }[]; summary: { total_marks: number; total_max: number; percent: number; grade: string | null; position: number } }

/** Published results only (frozen snapshot). report_card() refuses anyone who is not this child's guardian. */
export default function Results() {
  const { tr } = useApp();
  const [sums, setSums] = useState<Sum[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [exams, setExams] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Card_ | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [r, e, st] = await Promise.all([
        supabase.from('result_summaries').select('exam_id, student_id, percent, grade, position'),
        supabase.from('exams').select('id, name').eq('status', 'published'),
        supabase.from('students').select('id, full_name'),
      ]);
      if (r.error) setErr(r.error.message);
      setExams(Object.fromEntries((e.data ?? []).map((x) => [x.id as string, x.name as string])));
      setNames(Object.fromEntries((st.data ?? []).map((x) => [x.id as string, x.full_name as string])));
      setSums(((r.data ?? []) as Sum[]).filter((x) => x.exam_id));
    })();
  }, []);

  async function show(x: Sum) {
    setErr(null);
    const { data, error } = await supabase.rpc('report_card', { p_student: x.student_id, p_exam: x.exam_id });
    if (error) return setErr(error.message);
    setOpen(data as Card_ | null);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.pad}>
        {sums === null && !err ? <Loading /> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {open ? (
          <Card>
            <T style={{ fontWeight: '700', fontSize: 18 }}>{open.student.name} · {open.exam.name}</T>
            {open.lines.map((l) => (
              <View key={l.subject} style={s.row}>
                <T>{l.subject}</T>
                <T ltr>{l.status === 'present' ? `${l.marks}/${l.max_marks}  ${l.grade ?? ''}` : l.status}</T>
              </View>
            ))}
            <View style={s.row}><T style={{ fontWeight: '700' }}>{tr('ui.total')}</T><T ltr style={{ fontWeight: '700' }}>{open.summary.total_marks}/{open.summary.total_max} · {open.summary.percent}% · {open.summary.grade}</T></View>
            <Muted>{tr('ui.position')}: {open.summary.position}</Muted>
            <Button secondary label={tr('ui.back')} onPress={() => setOpen(null)} />
          </Card>
        ) : (
          <>
            {sums?.length === 0 ? <Muted>{tr('family.noResults')}</Muted> : null}
            {(sums ?? []).map((x) => (
              <Card key={`${x.exam_id}-${x.student_id}`}>
                <T style={{ fontWeight: '700' }}>{names[x.student_id]} · {exams[x.exam_id]}</T>
                <T ltr>{x.percent}% · {x.grade}</T>
                <Button label={tr('mobile.results.open')} onPress={() => void show(x)} />
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
