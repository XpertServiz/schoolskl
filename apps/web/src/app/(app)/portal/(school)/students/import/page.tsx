import { createHash } from 'node:crypto';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseStudentSheet, STUDENT_TEMPLATE_CSV } from '@ilmora/providers';
import { t } from '@ilmora/i18n';
import { Flash } from '@/components/flash';
import { done, fail, getLocale, need, portal } from '@/lib/portal';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'Import students', robots: { index: false, follow: false } };
const here = '/portal/students/import';
const uuid = z.string().uuid();
const ROW_ERRORS = ['class_unknown', 'section_unknown', 'section_required', 'name_required', 'guardian_required', 'phone_invalid', 'dob_invalid', 'gender_invalid', 'duplicate_in_file', 'already_on_file', 'no_current_session'];

/**
 * Upload → the database checks every row (dry run) → a person reads the problems and either fixes the file or adds the students.
 * The idempotency key is the file's hash, so uploading the same file twice opens the same batch instead of a second copy.
 */
async function upload(form: FormData) {
  'use server';
  const locale = await getLocale();
  const tr = (k: string, v: Record<string, string> = {}) => t(locale, k, v);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 900_000) return fail(here, { message: tr('import.err.file') });
  const text = await file.text();
  const sheet = parseStudentSheet(text);
  if (sheet.missing.length) return fail(here, { message: tr('import.err.headers', { cols: sheet.missing.join(', ') }) });
  if (sheet.tooMany) return fail(here, { message: tr('import.err.tooMany') });
  if (sheet.rows.length === 0) return fail(here, { message: tr('import.err.noRows') });
  const sb = await supabaseServer();
  const key = 'students:' + createHash('sha256').update(text).digest('hex');
  const { data: batch, error } = await sb.rpc('import_batch_create', { p_entity: 'students', p_rows: sheet.rows, p_idempotency_key: key });
  if (error) return fail(here, error);
  const { data: cur } = await sb.from('import_batches').select('status').eq('id', batch).single();
  if (cur && ['uploaded', 'dry_run_ok', 'dry_run_failed'].includes(cur.status)) {
    const dr = await sb.rpc('import_batch_dry_run', { p_batch: batch });
    if (dr.error) return fail(`${here}?batch=${batch}`, dr.error);
  }
  redirect(`${here}?batch=${batch}`);
}

async function recheck(form: FormData) {
  'use server';
  const id = uuid.parse(form.get('batch'));
  const sb = await supabaseServer();
  const { error } = await sb.rpc('import_batch_dry_run', { p_batch: id });
  if (error) return fail(`${here}?batch=${id}`, error);
  revalidatePath(here);
  redirect(`${here}?batch=${id}`);
}

async function commit(form: FormData) {
  'use server';
  const id = uuid.parse(form.get('batch'));
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('import_batch_commit', { p_batch: id });
  if (error) return fail(`${here}?batch=${id}`, error);
  revalidatePath('/portal/students');
  done(`${here}?batch=${id}`, t(await getLocale(), 'import.committed', { n: String((data as { committed?: number })?.committed ?? 0) }));
}

async function rollback(form: FormData) {
  'use server';
  const id = uuid.parse(form.get('batch'));
  const sb = await supabaseServer();
  const { error } = await sb.rpc('import_batch_rollback', { p_batch: id });
  if (error) return fail(`${here}?batch=${id}`, error);
  revalidatePath('/portal/students');
  done(`${here}?batch=${id}`, t(await getLocale(), 'import.rolledBack'));
}

type Raw = { full_name?: string; class?: string; section?: string; guardian_phone?: string };

export default async function ImportStudents({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; batch?: string }> }) {
  const p = await portal();
  need(p, 'data.import');
  need(p, 'students.create');
  const sp = await searchParams;
  const batchId = uuid.safeParse(sp.batch).success ? sp.batch! : null;

  const [{ data: recent }, { data: batch }, { data: rows }] = await Promise.all([
    p.sb.from('import_batches').select('id, status, summary, created_at').eq('entity', 'students').order('created_at', { ascending: false }).limit(10),
    batchId ? p.sb.from('import_batches').select('id, status, summary, created_at').eq('id', batchId).eq('entity', 'students').maybeSingle() : Promise.resolve({ data: null }),
    batchId ? p.sb.from('import_rows').select('row_no, raw, status, errors').eq('batch_id', batchId).order('row_no').limit(2000) : Promise.resolve({ data: [] }),
  ]);
  const summary = (batch?.summary ?? {}) as { valid?: number; errors?: number; committed?: number };
  const bad = (rows ?? []).filter((r) => r.status === 'error');
  const errText = (code: string) => (ROW_ERRORS.includes(code) ? p.tr(`import.err.${code}`) : code);
  const template = 'data:text/csv;charset=utf-8,' + encodeURIComponent(STUDENT_TEMPLATE_CSV);

  return (
    <>
      <p><Link href="/portal/students">← {p.tr('students.title')}</Link></p>
      <h1>{p.tr('import.title')}</h1>
      <Flash sp={sp} />
      <p>{p.tr('import.intro')}</p>
      <p className="muted">{p.tr('import.how')}</p>
      <p><a href={template} download="students-example.csv">{p.tr('import.template')}</a></p>

      <form action={upload} className="form card">
        <label>{p.tr('import.file')}<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <button className="btn">{p.tr('import.upload')}</button>
      </form>

      {batch ? (
        <section className="card" style={{ marginTop: '1.25rem' }}>
          <h2><span className="pill">{p.tr(`import.status.${batch.status}`)}</span></h2>
          <p>{p.tr('import.summary', { valid: String(summary.valid ?? 0), errors: String(summary.errors ?? 0) })}</p>

          {batch.status === 'dry_run_ok' ? (
            <form action={commit}><input type="hidden" name="batch" value={batch.id} /><button className="btn">{p.tr('import.commit', { n: String(summary.valid ?? 0) })}</button></form>
          ) : null}
          {batch.status === 'dry_run_failed' ? (
            <>
              <p className="muted">{p.tr('import.fixHint')}</p>
              <div className="table-scroll"><table className="grid">
                <thead><tr><th>{p.tr('import.row')}</th><th>{p.tr('ui.name')}</th><th>{p.tr('students.class')}</th><th>{p.tr('students.guardianPhone')}</th><th>{p.tr('import.problems')}</th></tr></thead>
                <tbody>{bad.map((r) => {
                  const raw = r.raw as Raw;
                  return (
                    <tr key={r.row_no}>
                      <td className="num">{r.row_no + 1 /* +1: the header is row 1 in the spreadsheet */}</td>
                      <td>{raw.full_name || '—'}</td>
                      <td>{raw.class || '—'}{raw.section ? ` · ${raw.section}` : ''}</td>
                      <td className="ltr">{raw.guardian_phone || '—'}</td>
                      <td><ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>{(r.errors as string[]).map((e) => <li key={e}>{errText(e)}</li>)}</ul></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <form action={recheck} style={{ marginTop: '.75rem' }}><input type="hidden" name="batch" value={batch.id} /><button className="btn secondary small">{p.tr('import.check')}</button></form>
            </>
          ) : null}
          {batch.status === 'committed' ? (
            <form action={rollback}>
              <input type="hidden" name="batch" value={batch.id} />
              <p className="muted">{p.tr('import.rollbackHint')}</p>
              <button className="btn secondary">{p.tr('import.rollback')}</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {(recent ?? []).length ? (
        <>
          <h2>{p.tr('import.recent')}</h2>
          <div className="table-scroll"><table className="grid">
            <thead><tr><th>{p.tr('ui.date')}</th><th>{p.tr('ui.status')}</th><th>{p.tr('import.rows')}</th></tr></thead>
            <tbody>{(recent ?? []).map((b) => {
              const s = (b.summary ?? {}) as { valid?: number; errors?: number };
              return (
                <tr key={b.id}>
                  <td className="ltr"><Link href={`${here}?batch=${b.id}`}>{String(b.created_at).slice(0, 16).replace('T', ' ')}</Link></td>
                  <td><span className="pill">{p.tr(`import.status.${b.status}`)}</span></td>
                  <td className="num">{(s.valid ?? 0) + (s.errors ?? 0)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </>
      ) : null}
    </>
  );
}
