/**
 * PII redaction for model calls. Values are replaced with stable placeholders
 * before the prompt leaves the platform and restored in the model's tool
 * arguments, so an agent can still email [EMAIL_1] without the model ever
 * seeing the address.
 */

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,16}\b/g },
  { kind: 'AADHAAR', re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { kind: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { kind: 'PHONE', re: /(?:\+?\d{1,3}[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g },
];

export class Redactor {
  private readonly toPlaceholder = new Map<string, string>();
  private readonly toValue = new Map<string, string>();
  private counts: Record<string, number> = {};

  get size(): number {
    return this.toValue.size;
  }

  redact(text: string): string {
    let out = text;
    for (const { kind, re } of PATTERNS) {
      out = out.replace(re, (match) => {
        if (/^\[[A-Z]+_\d+\]$/.test(match)) return match;
        const existing = this.toPlaceholder.get(match);
        if (existing) return existing;
        this.counts[kind] = (this.counts[kind] ?? 0) + 1;
        const placeholder = `[${kind}_${this.counts[kind]}]`;
        this.toPlaceholder.set(match, placeholder);
        this.toValue.set(placeholder, match);
        return placeholder;
      });
    }
    return out;
  }

  restore<T>(value: T): T {
    if (this.toValue.size === 0) return value;
    if (typeof value === 'string') {
      return value.replace(/\[[A-Z]+_\d+\]/g, (p) => this.toValue.get(p) ?? p) as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.restore(v)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.restore(v)])) as T;
    }
    return value;
  }
}
