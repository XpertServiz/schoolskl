// Shared Zod schemas (web + mobile). Mirror the DB constraints so users get field errors before a round trip.
import { z } from 'zod';

export const RESERVED_SLUGS = ['www', 'app', 'admin', 'api', 'vendor', 'auth', 'static', 'cdn', 'mail', 'portal'] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Use 3–63 lowercase letters, digits or hyphens')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'This name is reserved');

export const localeSchema = z.enum(['en', 'ur']);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const createTenantSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(2).max(120),
  planKey: z.enum(['starter', 'growth', 'chain', 'enterprise']).default('starter'),
  region: z.string().trim().min(2).max(8).default('pk'),
  locale: localeSchema.default('en'),
  adminEmail: z.string().email().optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** Pakistani mobile in any common spelling → E.164 (+923XXXXXXXXX). Used for parent OTP login. */
export const pkMobileSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .transform((s) => (s.startsWith('+92') ? s : s.startsWith('0092') ? `+${s.slice(2)}` : s.startsWith('92') ? `+${s}` : s.startsWith('0') ? `+92${s.slice(1)}` : s))
  .pipe(z.string().regex(/^\+923\d{9}$/, 'Enter a Pakistani mobile number, e.g. 0300 1234567'));

export const impersonationRequestSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Explain why (at least 10 characters)'),
  ticketRef: z.string().trim().min(1),
  minutes: z.number().int().min(1).max(30).default(30),
});

export const campusImportRowSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(80).optional(),
});
