const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE = /^[1-9][0-9]{5}$/;
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().toUpperCase() : '');

/** A GSTIN: the pattern and its check digit (mod 36 over the first 14 characters). */
export function isValidGstin(s: string): boolean {
  const v = clean(s);
  if (!GSTIN.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GST_CHARS.indexOf(v[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === v[14];
}

export function isValidPan(s: string): boolean {
  return PAN.test(clean(s));
}

export function isValidIfsc(s: string): boolean {
  return IFSC.test(clean(s));
}

export function isValidPincode(s: string): boolean {
  return PINCODE.test(clean(s));
}
