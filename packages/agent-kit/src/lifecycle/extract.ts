import type { RequiredDetail, Requester } from '@onehuman/schemas';

/** Lowercase, keep letters, digits and spaces, collapse whitespace. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(t: string): string {
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

function stemmed(text: string): string {
  return normalizeText(text).split(' ').filter(Boolean).map(stem).join(' ');
}

/** True when the phrase appears as whole words (plurals folded) in the text. */
export function phraseIn(text: string, phrase: string): boolean {
  const p = stemmed(phrase);
  return p.length > 0 && ` ${stemmed(text)} `.includes(` ${p} `);
}

const MAGNITUDE: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, thousand: 1e3, k: 1e3 };
const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?`;
const MAG = String.raw`(lakhs?|lacs?|crores?|cr|thousand|k)\b`;
const AMOUNT_PATTERNS = [
  // ₹45,000 · Rs 1.5 lakh · INR 12000
  new RegExp(String.raw`(?:₹|\brs\.?|\binr)\s*${NUM}(?:\s*${MAG})?`, 'gi'),
  // 1.5 lakh · 2 crore · 50k · 5 thousand (rupees)
  new RegExp(String.raw`\b${NUM}\s*${MAG}`, 'gi'),
  // 500 rupees · 4000 rs
  new RegExp(String.raw`\b${NUM}\s*(?:rupees?|rs\b\.?|inr\b)`, 'gi'),
];

/**
 * The largest rupee amount in the text, or null. Only numbers marked as money
 * (₹, Rs, INR, rupees) or with a size word (lakh, crore, thousand, k) count,
 * so ids, dates and measurements never become amounts.
 */
export function extractAmountInr(text: string): number | null {
  let best: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const whole = Number(m[1]!.replace(/,/g, ''));
      const value = m[2] ? Number(`${whole}.${m[2]}`) : whole;
      const mag = m[3] ? MAGNITUDE[m[3].toLowerCase()] ?? 1 : 1;
      const amount = Math.round(value * mag);
      if (Number.isFinite(amount) && amount > 0 && (best === null || amount > best)) best = amount;
    }
  }
  return best;
}

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE_PATTERNS = [
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\b`, 'i'),
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'i'),
  /\b(?:today|tonight|tomorrow|yesterday|next week|this week|next month)\b/i,
  /\b(?:next |this |on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

export function hasDate(text: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(text));
}

export function extractPhone(text: string): string | null {
  const indian = text.match(/(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/);
  if (indian) return indian[0];
  const general = text.match(/\+\d{1,3}[\d\s-]{8,14}\d/);
  return general ? general[0] : null;
}

export function extractEmail(text: string): string | null {
  return text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
}

/** Does the request carry this required detail? */
export function hasDetail(detail: RequiredDetail, text: string, requester?: Requester, amountInr?: number | null): boolean {
  switch (detail.kind) {
    case 'amount':
      return (amountInr ?? null) !== null || extractAmountInr(text) !== null;
    case 'date':
      return hasDate(text);
    case 'phone':
      return !!requester?.phone || extractPhone(text) !== null;
    case 'email':
      return !!requester?.email || extractEmail(text) !== null;
    case 'contact':
      return !!requester?.phone || !!requester?.email || extractPhone(text) !== null || extractEmail(text) !== null;
    case 'keywords':
      return (detail.keywords ?? []).some((k) => phraseIn(text, k));
  }
}
