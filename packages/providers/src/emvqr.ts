// EMVCo Merchant-Presented Mode QR payload (the public EMV QR Code spec that Raast P2M and wallet QRs build on).
// DECISION: the scheme-specific merchant-account template (which tag 02–51, which sub-tags, the Raast network id and IBAN/merchant id)
// is supplied by the caller — it must come from the State Bank / acquirer specification you are onboarded with, not be guessed here.

export const tlv = (id: string, value: string): string => {
  if (!/^\d{2}$/.test(id)) throw new Error(`bad tag ${id}`);
  if (value.length > 99) throw new Error(`tag ${id} value too long (${value.length} > 99)`);
  return id + String(value.length).padStart(2, '0') + value;
};

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as EMV QR requires, upper-case hex, 4 chars. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface AccountTemplate { tag: string; entries: [subTag: string, value: string][] }

export interface MerchantQr {
  merchantName: string;   // ≤ 25 chars
  merchantCity: string;   // ≤ 15 chars
  accountTemplates: AccountTemplate[]; // at least one, tags 02–51, supplied by the scheme spec
  /** minor units (paisa). Omit for a static QR where the payer types the amount. */
  amountMinor?: bigint;
  billNumber?: string;    // our voucher consumer number → comes back on the payment notification (sub-tag 01 of tag 62)
  mcc?: string;           // merchant category code, default 8211 (schools)
  countryCode?: string;   // default PK
  currencyNumeric?: string; // ISO 4217 numeric, default 586 (PKR)
}

/** Major-unit decimal string from minor units without floats: 150050n → "1500.50". */
export const amountString = (minor: bigint): string => {
  if (minor <= 0n) throw new Error('amount must be positive');
  const s = minor.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

export function buildQr(q: MerchantQr): string {
  if (!q.merchantName || q.merchantName.length > 25) throw new Error('merchantName must be 1–25 characters');
  if (!q.merchantCity || q.merchantCity.length > 15) throw new Error('merchantCity must be 1–15 characters');
  if (!q.accountTemplates.length) throw new Error('at least one merchant account template is required');
  const dynamic = q.amountMinor !== undefined;
  let out = tlv('00', '01') + tlv('01', dynamic ? '12' : '11');
  for (const t of [...q.accountTemplates].sort((a, b) => a.tag.localeCompare(b.tag))) {
    if (Number(t.tag) < 2 || Number(t.tag) > 51) throw new Error(`merchant account tag ${t.tag} must be 02–51`);
    out += tlv(t.tag, t.entries.map(([k, v]) => tlv(k, v)).join(''));
  }
  out += tlv('52', q.mcc ?? '8211') + tlv('53', q.currencyNumeric ?? '586');
  if (dynamic) out += tlv('54', amountString(q.amountMinor!));
  out += tlv('58', q.countryCode ?? 'PK') + tlv('59', q.merchantName) + tlv('60', q.merchantCity);
  if (q.billNumber) {
    if (!/^[A-Za-z0-9]{1,25}$/.test(q.billNumber)) throw new Error('billNumber must be 1–25 alphanumerics');
    out += tlv('62', tlv('01', q.billNumber));
  }
  out += '6304';
  return out + crc16(out);
}

export interface ParsedQr { fields: Record<string, string>; crcValid: boolean }

export function parseQr(payload: string): ParsedQr {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2), len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || i + 4 + len > payload.length) throw new Error('malformed EMV QR');
    fields[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  const body = payload.slice(0, payload.length - 4);
  return { fields, crcValid: payload.slice(-8, -4) === '6304' && crc16(body) === payload.slice(-4) };
}
