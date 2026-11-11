import { parseCsv } from './bankfile';

// A school's student list (exported from Excel/Google Sheets as CSV) → rows for the 'students' import handler. Column names vary from
// school to school, so headers are matched loosely (case, spaces and punctuation ignored) against a few common spellings. Values are
// passed through as text: the database validates and explains every problem per row (dry run), so nothing is silently "fixed" here.

export const STUDENT_COLUMNS = ['full_name', 'class', 'section', 'guardian_name', 'guardian_phone', 'dob', 'gender'] as const;
export type StudentColumn = (typeof STUDENT_COLUMNS)[number];
export const REQUIRED_STUDENT_COLUMNS: StudentColumn[] = ['full_name', 'class', 'guardian_name', 'guardian_phone'];
export const MAX_STUDENT_ROWS = 2000;

const ALIASES: Record<StudentColumn, string[]> = {
  full_name: ['full_name', 'name', 'student_name', 'child_name', 'student', 'students_name', 'student_full_name'],
  class: ['class', 'grade', 'class_name', 'grade_class'],
  section: ['section', 'sec'],
  guardian_name: ['guardian_name', 'guardian', 'father_name', 'fathers_name', 'parent_name', 'father', 'parent', 'mother_name'],
  guardian_phone: ['guardian_phone', 'phone', 'mobile', 'father_phone', 'parent_phone', 'contact', 'phone_number', 'mobile_number', 'mobile_no', 'phone_no', 'contact_no', 'whatsapp'],
  dob: ['dob', 'date_of_birth', 'birth_date', 'birthday', 'd_o_b'],
  gender: ['gender', 'sex'],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface StudentSheet {
  rows: Record<StudentColumn, string>[];
  /** required columns that no header matched */
  missing: StudentColumn[];
  tooMany: boolean;
}

export function parseStudentSheet(text: string): StudentSheet {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map(norm);
  const index = {} as Record<StudentColumn, number>;
  for (const col of STUDENT_COLUMNS) index[col] = header.findIndex((h) => ALIASES[col].includes(h));
  const missing = REQUIRED_STUDENT_COLUMNS.filter((c) => index[c] < 0);
  const body = table.slice(1);
  if (missing.length) return { rows: [], missing, tooMany: false };
  if (body.length > MAX_STUDENT_ROWS) return { rows: [], missing, tooMany: true };
  const rows = body.map((cells) => {
    const r = {} as Record<StudentColumn, string>;
    for (const col of STUDENT_COLUMNS) r[col] = index[col] >= 0 ? (cells[index[col]] ?? '').trim() : '';
    return r;
  });
  return { rows, missing, tooMany: false };
}

/** A tiny example file schools can download and fill in. Fake names only. */
export const STUDENT_TEMPLATE_CSV =
  'full_name,class,section,guardian_name,guardian_phone,dob,gender\n' +
  'Ayesha Siddiqui,Grade 5,A,Mr Siddiqui,0300 1234567,2016-04-12,female\n' +
  'Hamza Siddiqui,Grade 3,A,Mr Siddiqui,0300 1234567,12/09/2018,male\n';
