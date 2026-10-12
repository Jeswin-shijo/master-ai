/**
 * An action's details as labelled lines a person can read ("Amount: ₹12,000"),
 * for approval screens on web and mobile. Internal ids are left out.
 */
export interface ReadableField {
  label: string;
  value: string;
}

const HIDDEN = new Set(['id', 'recordRef', 'currency', 'limit']);
const LABELS: Record<string, string> = {
  to: 'To',
  body: 'Message',
  entity: 'Record type',
  patch: 'Changes',
  data: 'Details',
  payer: 'From',
  recipient: 'To',
  start: 'When',
  assignee: 'Who',
  task: 'Job',
  due: 'Due',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function readableFields(args: Record<string, unknown>): ReadableField[] {
  const out: ReadableField[] = [];
  for (const [key, raw] of Object.entries(args)) {
    if (HIDDEN.has(key) || raw === undefined || raw === null || raw === '') continue;
    const value = readableValue(key, raw, args.currency);
    if (value) out.push({ label: LABELS[key] ?? labelOf(key), value });
  }
  return out;
}

export function readableValue(key: string, v: unknown, currency?: unknown): string {
  if (typeof v === 'number') return /amount|price|value|budget|total|cost/i.test(key) && (currency ?? 'INR') === 'INR' ? `₹${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    if (UUID.test(v)) return '';
    if (ISO.test(v)) return dateOf(v, v.length <= 10);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => readableValue(key, x)).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k, x]) => !HIDDEN.has(k) && x !== undefined && x !== null && x !== '')
      .map(([k, x]) => `${labelOf(k)}: ${readableValue(k, x)}`)
      .filter((line) => !line.endsWith(': '))
      .join(', ');
  }
  return String(v);
}

function labelOf(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dateOf(iso: string, dateOnly: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
  }).format(d);
}
