import { describe, expect, it } from 'vitest';
import { MAX_STUDENT_ROWS, parseStudentSheet, STUDENT_TEMPLATE_CSV } from './index';

describe('parseStudentSheet', () => {
  it('reads the template exactly', () => {
    const r = parseStudentSheet(STUDENT_TEMPLATE_CSV);
    expect(r.missing).toEqual([]);
    expect(r.rows).toEqual([
      { full_name: 'Ayesha Siddiqui', class: 'Grade 5', section: 'A', guardian_name: 'Mr Siddiqui', guardian_phone: '0300 1234567', dob: '2016-04-12', gender: 'female' },
      { full_name: 'Hamza Siddiqui', class: 'Grade 3', section: 'A', guardian_name: 'Mr Siddiqui', guardian_phone: '0300 1234567', dob: '12/09/2018', gender: 'male' },
    ]);
  });

  it('matches common school spellings of the headers, in any order, and leaves optional columns empty', () => {
    const csv = '﻿Mobile No.,Student Name,Father\'s Name,Grade\r\n0321-7654321,"Khan, Zara",Imran Khan,Grade 2\r\n';
    const r = parseStudentSheet(csv);
    expect(r.missing).toEqual([]);
    expect(r.rows).toEqual([{ full_name: 'Khan, Zara', class: 'Grade 2', section: '', guardian_name: 'Imran Khan', guardian_phone: '0321-7654321', dob: '', gender: '' }]);
  });

  it('reports which required columns are missing instead of guessing', () => {
    expect(parseStudentSheet('Name,Class\nAli,Grade 1\n').missing).toEqual(['guardian_name', 'guardian_phone']);
  });

  it('refuses files above the row limit', () => {
    const big = 'name,class,father,phone\n' + Array.from({ length: MAX_STUDENT_ROWS + 1 }, (_, i) => `Child ${i},Grade 1,Parent,0300 0000000`).join('\n');
    expect(parseStudentSheet(big)).toMatchObject({ tooMany: true, rows: [] });
  });
});
