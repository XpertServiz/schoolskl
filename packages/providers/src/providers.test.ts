import { describe, expect, it, vi } from 'vitest';
import { amountString, buildQr, crc16, hmac, normalise, parseQr, PROVIDERS, processWebhook, toMinor, verifySignature, withinTolerance } from './index';

describe('crc16 / EMV QR', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => expect(crc16('123456789')).toBe('29B1'));

  const tpl = [{ tag: '26', entries: [['00', 'example.scheme'], ['01', 'MERCHANT-0001']] as [string, string][] }];
  it('builds a dynamic QR whose CRC verifies and whose amount has no float error', () => {
    const qr = buildQr({ merchantName: 'Noor Academy', merchantCity: 'Lahore', accountTemplates: tpl, amountMinor: 150050n, billNumber: '1000000042' });
    const p = parseQr(qr);
    expect(p.crcValid).toBe(true);
    expect(p.fields['54']).toBe('1500.50');
    expect(p.fields['01']).toBe('12');
    expect(p.fields['53']).toBe('586');
    expect(p.fields['58']).toBe('PK');
    expect(parseQr(p.fields['62']! + '6304' + crc16(p.fields['62']! + '6304')).fields['01']).toBe('1000000042');
  });
  it('a static QR carries no amount; tampering breaks the CRC', () => {
    const qr = buildQr({ merchantName: 'Noor Academy', merchantCity: 'Lahore', accountTemplates: tpl });
    expect(parseQr(qr).fields['54']).toBeUndefined();
    expect(parseQr(qr).fields['01']).toBe('11');
    expect(parseQr(qr.replace('Lahore', 'Karach')).crcValid).toBe(false);
  });
  it('rejects over-long names, bad account tags and non-positive amounts', () => {
    expect(() => buildQr({ merchantName: 'x'.repeat(26), merchantCity: 'Lahore', accountTemplates: tpl })).toThrow();
    expect(() => buildQr({ merchantName: 'A', merchantCity: 'L', accountTemplates: [{ tag: '60', entries: [] }] })).toThrow();
    expect(() => amountString(0n)).toThrow();
    expect(amountString(5n)).toBe('0.05');
    expect(amountString(100n)).toBe('1.00');
  });
});

describe('signatures', () => {
  const secret = 's3cret', body = '{"a":1}';
  it('accepts the right signature (with optional prefix) and rejects everything else', () => {
    const sig = hmac(secret, body);
    expect(verifySignature({ secret, payload: body, signature: sig })).toBe(true);
    expect(verifySignature({ secret, payload: body, signature: `sha256=${sig}`, prefix: 'sha256=' })).toBe(true);
    expect(verifySignature({ secret, payload: body + ' ', signature: sig })).toBe(false);
    expect(verifySignature({ secret: 'other', payload: body, signature: sig })).toBe(false);
    expect(verifySignature({ secret, payload: body, signature: null })).toBe(false);
    expect(verifySignature({ secret, payload: body, signature: 'short' })).toBe(false);
    expect(verifySignature({ secret: '', payload: body, signature: sig })).toBe(false);
  });
  it('replay window', () => {
    expect(withinTolerance(1000, 1200, 300)).toBe(true);
    expect(withinTolerance(1000, 1400, 300)).toBe(false);
    expect(withinTolerance(Number.NaN, 1000, 300)).toBe(false);
  });
});

describe('amounts', () => {
  it('parses decimals exactly and refuses anything ambiguous', () => {
    expect(toMinor('1500.50', 'major')).toBe(150050n);
    expect(toMinor(1500, 'major')).toBe(150000n);
    expect(toMinor('0.07', 'major')).toBe(7n);
    expect(toMinor('150050', 'minor')).toBe(150050n);
    for (const bad of ['-1', '1e3', '1.234', '', 'abc', '1,000']) expect(() => toMinor(bad, 'major')).toThrow();
    expect(() => toMinor('10.5', 'minor')).toThrow();
  });
});

describe('processWebhook', () => {
  const cfg = PROVIDERS.jazzcash;
  const secret = 'whsec';
  const now = 1_800_000_000;
  const body = JSON.stringify({ event_id: 'e1', consumer_number: '1000000042', amount: '6000.00', transaction_ref: 'JC-9' });
  const hdr = (over: Record<string, string> = {}) => (n: string) => ({ 'x-signature': hmac(secret, body), 'x-timestamp': String(now), ...over })[n] ?? null;

  it('records a valid event once with normalised values', async () => {
    const record = vi.fn(async () => ({ paymentId: 'p1' }));
    const r = await processWebhook({ cfg, secret, rawBody: body, headers: hdr(), nowSec: now, record });
    expect(r).toEqual({ status: 200, body: { ok: true, code: 'recorded', paymentId: 'p1' } });
    expect(record).toHaveBeenCalledWith({ provider: 'jazzcash', eventId: 'e1', consumerNo: '1000000042', amountMinor: 600000n, providerRef: 'JC-9' });
  });
  it('never touches the database for bad signatures, stale timestamps, or an unconfigured provider', async () => {
    const record = vi.fn(async () => ({ paymentId: 'p' }));
    expect((await processWebhook({ cfg, secret, rawBody: body, headers: hdr({ 'x-signature': 'nope' }), nowSec: now, record })).status).toBe(401);
    expect((await processWebhook({ cfg, secret, rawBody: body, headers: hdr(), nowSec: now + 10_000, record })).status).toBe(401);
    expect((await processWebhook({ cfg, secret, rawBody: body, headers: (n) => (n === 'x-signature' ? hmac(secret, body) : null), nowSec: now, record })).status).toBe(401);
    expect((await processWebhook({ cfg, secret: undefined, rawBody: body, headers: hdr(), nowSec: now, record })).status).toBe(503);
    expect(record).not.toHaveBeenCalled();
  });
  it('a signed but malformed payload is a 400; an unknown consumer is 202; other failures 500 so the provider retries', async () => {
    const bad = '{"event_id":"e","consumer_number":"1","amount":"-5"}';
    const h = (n: string) => ({ 'x-signature': hmac(secret, bad), 'x-timestamp': String(now) })[n] ?? null;
    expect((await processWebhook({ cfg, secret, rawBody: bad, headers: h, nowSec: now, record: async () => ({ paymentId: null }) })).status).toBe(400);
    expect((await processWebhook({ cfg, secret, rawBody: body, headers: hdr(), nowSec: now, record: async () => { throw new Error('unknown consumer number'); } })).status).toBe(202);
    expect((await processWebhook({ cfg, secret, rawBody: body, headers: hdr(), nowSec: now, record: async () => { throw new Error('db down'); } })).status).toBe(500);
  });
  it('normalise reads nested field paths', () => {
    const c = { ...cfg, fields: { ...cfg.fields, eventId: 'data.id', amount: 'data.amt', amountUnit: 'minor' as const } };
    expect(normalise(c, { data: { id: 7, amt: '1200' }, consumer_number: 'c' }).amountMinor).toBe(1200n);
  });
});
