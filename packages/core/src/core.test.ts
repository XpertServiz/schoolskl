import { describe, expect, it } from 'vitest';
import { add, allocate, can, classifyHost, formatMoney, money, parseMoney, sub } from './index';

describe('money', () => {
  it('parses decimals without floats', () => {
    expect(parseMoney('1,500.50', 'PKR').minor).toBe(150050n);
    expect(parseMoney('0.1', 'PKR').minor).toBe(10n);
    expect(parseMoney('-20', 'PKR').minor).toBe(-2000n);
    expect(() => parseMoney('1.234', 'PKR')).toThrow();
  });
  it('rejects unsafe numbers and mixed currencies', () => {
    expect(() => money(1.5, 'PKR')).toThrow();
    expect(() => add(money(1n, 'PKR'), money(1n, 'USD'))).toThrow();
    expect(sub(money(500n, 'PKR'), money(200n, 'PKR')).minor).toBe(300n);
  });
  it('allocate never loses or invents a paisa', () => {
    for (const total of [10000n, 10001n, 1n, -10001n, 0n]) {
      const parts = allocate(money(total, 'PKR'), 3);
      expect(parts.reduce((s, p) => s + p.minor, 0n)).toBe(total);
    }
  });
  it('formats at the edge', () => {
    expect(formatMoney(money(150050n, 'PKR'))).toBe('PKR 1,500.50');
    expect(formatMoney(money(-5n, 'PKR'))).toBe('-PKR 0.05');
  });
});

describe('can()', () => {
  const tenantWide = { type: 'tenant' as const };
  const campusA = { type: 'campus' as const, id: 'a' };
  const role = [{ key: 'fees.collect', scope: campusA }];
  it('campus-scoped role does not leak to another campus', () => {
    expect(can('fees.collect', campusA, { roleGrants: role, overrides: [] })).toBe(true);
    expect(can('fees.collect', { type: 'campus', id: 'b' }, { roleGrants: role, overrides: [] })).toBe(false);
  });
  it('deny beats grant; expired overrides are ignored', () => {
    const roleGrants = [{ key: 'students.view', scope: tenantWide }];
    const deny = [{ key: 'students.view', effect: 'deny' as const, scope: tenantWide }];
    expect(can('students.view', tenantWide, { roleGrants, overrides: deny })).toBe(false);
    const expired = [{ ...deny[0]!, expiresAt: new Date(Date.now() - 1000) }];
    expect(can('students.view', tenantWide, { roleGrants, overrides: expired })).toBe(true);
  });
  it('MFA keys need aal2 and unknown keys never pass', () => {
    const roleGrants = [{ key: 'payroll.post', scope: tenantWide }, { key: 'nope.nope', scope: tenantWide }];
    expect(can('payroll.post', tenantWide, { roleGrants, overrides: [], aal: 'aal1' })).toBe(false);
    expect(can('payroll.post', tenantWide, { roleGrants, overrides: [], aal: 'aal2' })).toBe(true);
    expect(can('nope.nope', tenantWide, { roleGrants, overrides: [], aal: 'aal2' })).toBe(false);
  });
});

describe('classifyHost', () => {
  it('classifies hosts', () => {
    expect(classifyHost('ilmora.pk', 'ilmora.pk')).toEqual({ kind: 'root' });
    expect(classifyHost('noor.ilmora.pk:3000', 'ilmora.pk')).toEqual({ kind: 'tenant-subdomain', slug: 'noor' });
    expect(classifyHost('vendor.ilmora.pk', 'ilmora.pk')).toEqual({ kind: 'reserved', label: 'vendor' });
    expect(classifyHost('www.myschool.edu.pk', 'ilmora.pk')).toEqual({ kind: 'custom-domain', host: 'www.myschool.edu.pk' });
    expect(classifyHost('a.b.ilmora.pk', 'ilmora.pk').kind).toBe('custom-domain');
    expect(classifyHost('noor.localhost:3000', 'ilmora.pk')).toEqual({ kind: 'tenant-subdomain', slug: 'noor' });
  });
});

describe('formatRupees (display: no decimals)', () => {
  it('drops the paisa and rounds half away from zero', async () => {
    const { formatRupees } = await import('./index');
    expect(formatRupees(money(5000000n, 'PKR'))).toBe('PKR 50,000');
    expect(formatRupees(money(150050n, 'PKR'))).toBe('PKR 1,501');
    expect(formatRupees(money(150049n, 'PKR'))).toBe('PKR 1,500');
    expect(formatRupees(money(-250000n, 'PKR'))).toBe('PKR -2,500'.replace('PKR -', '-PKR '));
    expect(formatRupees(money(0n, 'PKR'))).toBe('PKR 0');
    expect(formatRupees(money(-10n, 'PKR'))).toBe('PKR 0');
  });
});
