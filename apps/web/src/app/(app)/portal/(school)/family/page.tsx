import Link from 'next/link';
import { Flash } from '@/components/flash';
import type { BusStatus } from '@/lib/bus';
import { portal } from '@/lib/portal';
import { BusSection } from './bus-section';

export const metadata = { title: 'My family', robots: { index: false, follow: false } };

/** The parent's view. Every query is plain RLS: a guardian can only ever read their own family's children, vouchers and published results. */
export default async function Family({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const p = await portal();
  const sp = await searchParams;
  const { data: students } = await p.sb.from('students').select('id, full_name, admission_no, family_id').order('full_name');
  const ids = (students ?? []).map((s) => s.id);
  const [{ data: vouchers }, { data: results }, { data: exams }, { data: att }] = ids.length
    ? await Promise.all([
        p.sb.from('vouchers').select('id, student_id, voucher_no, period, due_date, status, total_minor, adjusted_minor, paid_minor').neq('status', 'cancelled').order('period', { ascending: false }).limit(60),
        p.sb.from('result_summaries').select('exam_id, student_id, percent, grade, position'),
        p.sb.from('exams').select('id, name').eq('status', 'published'),
        p.sb.from('student_attendance').select('student_id, status').gte('att_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const exam = new Map((exams ?? []).map((e) => [e.id as string, e.name as string]));
  const { data: busRows } = ids.length ? await p.sb.rpc('my_bus_status') : { data: [] };
  const bus = new Map(((busRows ?? []) as BusStatus[]).map((b) => [b.student_id, b]));

  return (
    <>
      <h1>{p.tr('family.title')}</h1>
      <Flash sp={sp} />
      {(students ?? []).length === 0 ? <p className="muted">{p.tr('ui.empty')}</p> : null}
      {(students ?? []).map((s) => {
        const vs = (vouchers ?? []).filter((v) => v.student_id === s.id);
        const rs = (results ?? []).filter((r) => r.student_id === s.id && exam.has(r.exam_id));
        const days = (att ?? []).filter((a) => a.student_id === s.id);
        const present = days.filter((a) => a.status === 'present' || a.status === 'late').length;
        return (
          <section key={s.id} className="card" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ marginTop: 0 }}>{s.full_name} <span className="muted ltr">{s.admission_no}</span></h2>

            <h3>{p.tr('family.fees')}</h3>
            {vs.length === 0 ? <p className="muted">{p.tr('family.noFees')}</p> : (
              <div className="table-scroll"><table className="grid">
                <thead><tr><th>{p.tr('fees.voucher')}</th><th>{p.tr('ui.due')}</th><th className="num">{p.tr('ui.balance')}</th><th /></tr></thead>
                <tbody>{vs.map((v) => {
                  const bal = Number(v.total_minor) + Number(v.adjusted_minor) - Number(v.paid_minor);
                  return <tr key={v.id}><td className="ltr">{v.voucher_no}</td><td className="ltr">{v.due_date}</td><td className="num">{bal > 0 ? p.fmt(bal) : p.tr('ui.paid')}</td>
                    <td><Link href={`/portal/fees/voucher/${v.id}`}>{p.tr('fees.challan')}</Link></td></tr>;
                })}</tbody>
              </table></div>
            )}

            <h3>{p.tr('family.results')}</h3>
            {rs.length === 0 ? <p className="muted">{p.tr('family.noResults')}</p> : (
              <ul>{rs.map((r) => <li key={r.exam_id}><Link href={`/portal/family/report/${s.id}/${r.exam_id}`}>{exam.get(r.exam_id)}</Link> — <span className="ltr">{r.percent}% · {r.grade}</span></li>)}</ul>
            )}

            <h3>{p.tr('family.attendance')}</h3>
            <p className="ltr">{days.length ? `${present}/${days.length}` : '—'}</p>

            {bus.has(s.id) ? <BusSection p={p} b={bus.get(s.id)!} back="/portal/family" /> : null}
          </section>
        );
      })}
    </>
  );
}
