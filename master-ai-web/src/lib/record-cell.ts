import type { EntityField } from '@onehuman/schemas';
import { formatInr, formatValue } from './utils';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record value as the Records table shows it: rupees for money, dates and
 * times in words (never raw ISO text), Yes/No, and a dash for nothing.
 * `timeZone` is for tests; the page uses the viewer's own.
 */
export function recordCell(field: EntityField | undefined, value: unknown, timeZone?: string): string {
  if (field?.type === 'money' && typeof value === 'number') return formatInr(value);
  if ((field?.type === 'date' || field?.type === 'datetime') && typeof value === 'string') {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return value;
    // A plain date is a calendar day: read it in UTC so no time zone moves it.
    if (field.type === 'date' || DATE.test(value)) {
      return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DATE.test(value) ? 'UTC' : timeZone });
    }
    return at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone });
  }
  return formatValue(value);
}
