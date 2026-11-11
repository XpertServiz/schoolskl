import { describe, expect, it } from 'vitest';
import { createTenantSchema, impersonationRequestSchema, pkMobileSchema, slugSchema } from './index';

describe('validation', () => {
  it('slugs', () => {
    expect(slugSchema.parse('  Noor-Academy ')).toBe('noor-academy');
    expect(slugSchema.safeParse('admin').success).toBe(false);
    expect(slugSchema.safeParse('-bad').success).toBe(false);
    expect(slugSchema.safeParse('ab').success).toBe(false);
  });
  it('Pakistani mobile numbers normalise to E.164', () => {
    for (const v of ['0300 1234567', '03001234567', '923001234567', '+92 300-1234567', '00923001234567']) {
      expect(pkMobileSchema.parse(v)).toBe('+923001234567');
    }
    expect(pkMobileSchema.safeParse('0211234567').success).toBe(false);
  });
  it('create tenant applies defaults', () => {
    expect(createTenantSchema.parse({ slug: 'noor', name: 'Noor Academy' })).toMatchObject({ planKey: 'starter', region: 'pk', locale: 'en' });
  });
  it('impersonation needs a real reason and ≤30 minutes', () => {
    const base = { tenantId: '00000000-0000-4000-8000-000000000001', ticketRef: 'T-1' };
    expect(impersonationRequestSchema.safeParse({ ...base, reason: 'short' }).success).toBe(false);
    expect(impersonationRequestSchema.safeParse({ ...base, reason: 'import help requested', minutes: 31 }).success).toBe(false);
  });
});
