import { notFound } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { PrintButton } from '@/components/print-button';
import { portal } from '@/lib/portal';

export const metadata = { title: 'Report card', robots: { index: false, follow: false } };

interface Card {
  student: { name: string; admission_no: string };
  exam: { name: string };
  lines: { subject: string; marks: number | null; max_marks: number; percent: number | null; grade: string | null; status: string }[];
  summary: { total_marks: number; total_max: number; percent: number; grade: string | null; position: number };
  scale: { min_percent: number; grade: string; remark: string | null }[];
}

/** Shows the frozen published snapshot only. The RPC refuses anyone who is neither this child's guardian nor report-card staff. */
export default async function ReportCard({ params }: { params: Promise<{ student: string; exam: string }> }) {
  const { student, exam } = await params;
  if (!z.string().uuid().safeParse(student).success || !z.string().uuid().safeParse(exam).success) notFound();
  const p = await portal();
  const { data } = await p.sb.rpc('report_card', { p_student: student, p_exam: exam });
  const c = data as Card | null;
  if (!c) notFound();
  return (
    <>
      <p className="no-print inline"><Link href="/portal/family">← {p.tr('ui.back')}</Link><PrintButton label={p.tr('ui.print')} /></p>
      <section className="paper">
        <h1 style={{ fontSize: '1.75rem' }}>{p.access.tenant.name}</h1>
        <h2 style={{ marginTop: 0 }}>{c.exam.name}</h2>
        <p><strong>{c.student.name}</strong> <span className="ltr">({c.student.admission_no})</span></p>
        <table className="grid">
          <thead><tr><th>{p.tr('ui.name')}</th><th className="num">{p.tr('ui.total')}</th><th className="num">%</th><th>{p.tr('ui.grade')}</th></tr></thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.subject}>
                <td>{l.subject}</td>
                <td className="num">{l.status === 'present' ? `${l.marks}/${l.max_marks}` : l.status}</td>
                <td className="num">{l.percent ?? ''}</td><td>{l.grade ?? ''}</td>
              </tr>
            ))}
            <tr><th>{p.tr('ui.total')}</th><th className="num">{c.summary.total_marks}/{c.summary.total_max}</th><th className="num">{c.summary.percent}</th><th>{c.summary.grade}</th></tr>
          </tbody>
        </table>
        <p>{p.tr('ui.position')}: <span className="ltr">{c.summary.position}</span></p>
      </section>
    </>
  );
}
