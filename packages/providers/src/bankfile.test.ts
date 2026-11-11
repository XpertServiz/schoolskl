import { describe, expect, it } from 'vitest';
import { parseBankCsv, parseCsv, parseDate } from './index';

const map = { date: 'Date', dateFormat: 'dmy' as const, description: 'Narration', reference: 'Ref', credit: 'Credit', debit: 'Debit' };

describe('parseCsv', () => {
  it('handles quotes, embedded commas/newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"line\nbreak",z\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['line\nbreak', 'z']]);
  });
});

describe('parseDate', () => {
  it('reads dmy/mdy/iso and rejects impossible dates', () => {
    expect(parseDate('05/11/2026', 'dmy')).toBe('2026-11-05');
    expect(parseDate('05/11/2026', 'mdy')).toBe('2026-05-11');
    expect(parseDate('2026-11-05 10:00', 'iso')).toBe('2026-11-05');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('garbage', 'dmy')).toBeNull();
  });
});

describe('parseBankCsv', () => {
  const csv = [
    'Date,Narration,Ref,Debit,Credit',
    '05/11/2026,"IBFT from ALI KHAN",1000000042,,"6,000.00"',
    '06/11/2026,Electricity bill,,"12,500.00",',
    '07/11/2026,Cash deposit,CDM77,,1500.50',
    '31/02/2026,Bad date,,,100',
    '08/11/2026,Odd amount,,,12.345',
  ].join('\n');
  it('keeps credits only, converts to minor units exactly, and reports what it skipped and why', () => {
    const r = parseBankCsv(csv, map);
    expect(r.lines).toEqual([
      { date: '2026-11-05', description: 'IBFT from ALI KHAN', reference: '1000000042', amount_minor: 600000 },
      { date: '2026-11-07', description: 'Cash deposit', reference: 'CDM77', amount_minor: 150050 },
    ]);
    expect(r.skipped).toEqual([{ row: 5, reason: 'unreadable date' }, { row: 6, reason: 'unreadable amount' }]);
  });
  it('supports a single signed amount column and rejects a mapping to a missing column', () => {
    const r = parseBankCsv('Date,Details,Amount\n2026-11-05,In,1000\n2026-11-06,Out,-500\n2026-11-07,Out2,(300.00)', { date: 'Date', dateFormat: 'iso', description: 'Details', amount: 'Amount' });
    expect(r.lines.map((l) => l.amount_minor)).toEqual([100000]);
    expect(() => parseBankCsv(csv, { ...map, credit: 'Nope' })).toThrow(/not found/);
    expect(() => parseBankCsv(csv, { date: 'Date', dateFormat: 'dmy' })).toThrow(/credit column or a signed amount/);
  });
});
