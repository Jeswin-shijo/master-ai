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

const MAGNITUDE: Record<string, number> = {
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  l: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  thousand: 1e3,
  k: 1e3,
};

/**
 * A number, an optional size word, and an optional smaller part ("1 lakh 20
 * thousand"). The currency mark may sit before it, glued or spaced ("Rs1.5",
 * "₹ 2,00,000"). The look-behind stops a match starting inside a word, an id or
 * a decimal, so "Rs1.5 lakh" never also yields a bare "5 lakh".
 */
const AMOUNT = new RegExp(
  String.raw`(?<![\w.,])(?:(₹|rs\.?|inr|rupees?)\s*)?` +
    String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)` +
    String.raw`(?:(\s*)(lakhs?|lacs?|crores?|thousand|cr|k|l)\b)?` +
    String.raw`(?:\s+(?:and\s+)?(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|thousand|k)\b)?`,
  'gi',
);

/** A currency word right after the number: "75,000/-", "500 rupees", "4000 rs" (not "Rs 2,400", which marks the next number). */
const CURRENCY_AFTER = /^\s*(?:rupees?\b|\/-|only\b|rs\b\.?(?!\s*\d)|inr\b(?!\s*\d))/i;

/** Quantities, not money: "50k km", "2 lakh bricks", "5 lakh litres". */
const UNIT_AFTER =
  /^\s*(?:%|(?:km|kms|kg|kgs|g|gm|ml|litres?|liters?|ltrs?|metres?|meters?|tonnes?|tons?|mt|units?|pcs|pieces|nos|bags|bricks|boxes|cartons|bottles|people|persons|users|customers|members|students|patients|visitors|views|followers|sq|sqft|ft|feet|acres?|hectares?|mw|kw|kwh|calls|messages|days|hours|months|years|percent)\b)/i;

/** Words that make a bare number money: "loan of 1,50,000", "budget 15L". */
const MONEY_WORDS =
  /\b(?:loan|amount|fees?|cost|costs|price|budget|bill|invoice|payment|pay|paid|refund|salary|deposit|advance|emi|quote|quotation|worth|value|balance|dues?|fine|penalty|rent|charges?|grant|donation|limit|sanction(?:ed)?|disburse(?:d|ment)?|purchase|spend|spent|expense|estimate|premium|claim|compensation|release|transfer)\b/i;

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/**
 * The largest rupee amount in the text, or null. A number is money when a
 * currency mark sits next to it (₹, Rs, INR, rupees, /-), or when it has a size
 * word or Indian digit grouping and a money word comes just before it ("loan of
 * 1,50,000", "budget 15L"). Ids, dates, measurements and quantities ("50k km",
 * "2 lakh bricks") are not money. The largest amount wins, the cautious choice
 * for approval limits.
 */
export function extractAmountInr(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(AMOUNT)) {
    const [whole, currency, digits, space, magWord, tailDigits, tailMag] = m;
    const start = m.index ?? 0;
    const after = text.slice(start + whole.length);
    const word = magWord?.toLowerCase();
    // A spaced lone "l" is litres ("5 l of oil"), not lakh ("15L").
    const litres = word === 'l' && (space ?? '') !== '';
    const mag = word && !litres ? MAGNITUDE[word]! : 1;
    let value = parseNumber(digits!) * mag;
    if (tailDigits && tailMag) {
      const tail = MAGNITUDE[tailMag.toLowerCase()]!;
      if (tail < mag) value += parseNumber(tailDigits) * tail;
    }

    const marked = !!currency || CURRENCY_AFTER.test(after);
    const quantity = litres || UNIT_AFTER.test(after);
    const sized = mag > 1 || digits!.includes(',');
    const moneyContext = MONEY_WORDS.test(text.slice(Math.max(0, start - 40), start));
    if (!(marked || (sized && moneyContext && !quantity))) continue;

    const amount = Math.round(value);
    if (Number.isFinite(amount) && amount > 0 && (best === null || amount > best)) best = amount;
  }
  return best;
}

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE_PATTERNS = [
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}\b/,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\b`, 'i'),
  new RegExp(String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`, 'i'),
  /\b(?:on|by|before|after|from|till|until)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/i,
  /\b(?:in|within)\s+\d+\s+(?:days?|weeks?|months?)\b/i,
  /\b(?:end|start|beginning)\s+of\s+(?:the\s+)?(?:week|month|year|quarter)\b/i,
  /\b(?:today|tonight|tomorrow|yesterday|next week|this week|next month)\b/i,
  /\b(?:next |this |on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

export function hasDate(text: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(text));
}

export function extractPhone(text: string): string | null {
  // Mobiles: +91 98450 12345, 9845012345, 09845012345.
  const mobile = text.match(/(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/);
  if (mobile) return mobile[0];
  // Landlines with an STD code: 0484 2345678, 044-23456789.
  const landline = text.match(/\b0\d{2,4}[\s-]?\d{6,8}\b/);
  if (landline) return landline[0];
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
