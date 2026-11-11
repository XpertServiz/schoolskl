import { toMinor } from './webhook';

// Bank statement CSV → credit lines for public.import_bank_statement. Every bank exports a different layout, so the columns are mapped
// by header name (case-insensitive); nothing here knows a specific bank's format. Only credits are kept — debits are not fee receipts.

export interface BankCsvMapping {
  date: string; dateFormat: 'iso' | 'dmy' | 'mdy';
  description?: string; reference?: string;
  /** use credit (+ optional debit) columns, OR a single signed amount column where positive = money in */
  credit?: string; debit?: string; amount?: string;
}

export interface BankLine { date: string; description: string; reference: string; amount_minor: number }
export interface BankParseResult { lines: BankLine[]; skipped: { row: number; reason: string }[] }

/** RFC-4180 style: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF or LF, BOM tolerated. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export function parseDate(s: string, fmt: BankCsvMapping['dateFormat']): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const sl = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fmt === 'iso') { if (!iso) return null; [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; }
  else { if (!sl) return null; const a = Number(sl[1]), b = Number(sl[2]); [y, m, d] = [Number(sl[3]), fmt === 'dmy' ? b : a, fmt === 'dmy' ? a : b]; }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 31 Feb etc.
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const cleanAmount = (s: string): { neg: boolean; digits: string } => {
  let t = s.replace(/PKR|Rs\.?/gi, '').replace(/[,\s]/g, '');
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-') || /DR$/i.test(t);
  t = t.replace(/[()-]/g, '').replace(/(CR|DR)$/i, '');
  return { neg, digits: t };
};

export function parseBankCsv(text: string, map: BankCsvMapping): BankParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], skipped: [] };
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name?: string): number => {
    if (!name) return -1;
    const i = head.indexOf(name.trim().toLowerCase());
    if (i < 0) throw new Error(`column "${name}" not found in the file (found: ${head.join(', ')})`);
    return i;
  };
  const iDate = col(map.date), iDesc = col(map.description), iRef = col(map.reference), iCr = col(map.credit), iAmt = col(map.amount);
  col(map.debit);
  if (iCr < 0 && iAmt < 0) throw new Error('map either a credit column or a signed amount column');

  const out: BankParseResult = { lines: [], skipped: [] };
  rows.slice(1).forEach((r, k) => {
    const rowNo = k + 2;
    const date = parseDate(r[iDate] ?? '', map.dateFormat);
    if (!date) return out.skipped.push({ row: rowNo, reason: 'unreadable date' }), undefined;
    const raw = (iCr >= 0 ? r[iCr] : r[iAmt]) ?? '';
    if (raw.trim() === '') return undefined; // a debit-only row: not a receipt, not an error
    const { neg, digits } = cleanAmount(raw);
    if (neg) return undefined; // money out
    let minor: bigint;
    try { minor = toMinor(digits, 'major'); } catch { return out.skipped.push({ row: rowNo, reason: 'unreadable amount' }), undefined; }
    if (minor <= 0n) return undefined;
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return out.skipped.push({ row: rowNo, reason: 'amount too large' }), undefined;
    out.lines.push({ date, description: (r[iDesc] ?? '').trim(), reference: (r[iRef] ?? '').trim(), amount_minor: Number(minor) });
  });
  return out;
}
