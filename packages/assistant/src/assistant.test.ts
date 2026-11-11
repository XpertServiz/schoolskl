import { describe, expect, it } from 'vitest';
import { detectLoc, distance, normalize, reply, tokens } from './index';

const id = (q: string, loc: 'en' | 'ur' = 'en') => {
  const r = reply(q, loc);
  return r.kind === 'answer' ? r.text.slice(0, 30) : r.kind;
};

describe('assistant', () => {
  it('understands Roman Urdu and chat spellings', () => {
    expect(reply('mjhe cost btao', 'en').text).toMatch(/قیمت/);
    expect(reply('kitna paisa lagega', 'en').link?.href).toBe('/pricing');
    expect(reply('demo dikhao', 'en').link?.href).toBe('/demo');
    expect(reply('app kese download karon', 'en').link?.href).toBe('/apps');
  });
  it('forgives typos but does not confuse short words (fee ≠ free)', () => {
    expect(reply('attandance system', 'en').text).toMatch(/Attendance/);
    expect(reply('payrol and salry', 'en').text).toMatch(/Payroll/);
    expect(distance('fee', 'free', 2)).toBeGreaterThan(0);
    expect(reply('whatsap numbr', 'en').text).toMatch(/WhatsApp/);
  });
  it('answers in Urdu for Urdu script and Roman Urdu, in the page language otherwise', () => {
    expect(detectLoc('فیس کتنی ہے', 'en')).toBe('ur');
    expect(detectLoc('mujhe fee batao', 'en')).toBe('ur');
    expect(detectLoc('what is the price', 'en')).toBe('en');
    expect(reply('price', 'ur').text).toMatch(/قیمت/);
  });
  it('handles greetings, thanks and unknown questions without inventing facts', () => {
    expect(reply('salam', 'en').kind).toBe('smalltalk');
    expect(reply('thanks', 'en').kind).toBe('smalltalk');
    const r = reply('what is the weather on mars', 'en');
    expect(r.kind).toBe('fallback');
    expect(r.chips.length).toBeGreaterThan(0);
  });
  it('is honest about things that are not built', () => {
    expect(reply('can parents pay by jazzcash', 'en').text).toMatch(/being integrated/);
    expect(reply('do you track my child with gps', 'en').text).toMatch(/never the child/);
  });
  it('caches answers (same object for the same normalised question)', () => {
    expect(reply('  Price?? ', 'en')).toBe(reply('price', 'en'));
  });
  it('normalises and tokenises', () => {
    expect(normalize('Mjhe,  COST!!')).toBe('mjhe cost');
    expect(tokens('mjhe cost btao')).toEqual(['cost']);
    expect(id('xyzzy')).toBe('fallback');
  });
});
