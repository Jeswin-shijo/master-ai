import type { EntityField } from '@onehuman/schemas';

/** A stored value as a form input holds it: text for inputs, a boolean for checkboxes. Date-times show in the viewer's time. */
export function formValue(field: EntityField, v: unknown): string | boolean {
  if (field.type === 'boolean') return v === true;
  if (v === undefined || v === null) return '';
  if (field.type === 'datetime' && typeof v === 'string') {
    const at = new Date(v);
    if (Number.isNaN(at.getTime())) return '';
    return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  if (field.type === 'date' && typeof v === 'string') return v.slice(0, 10);
  return String(v);
}

/** A form value as it is stored: numbers as numbers, date-times in UTC, blanks as null. */
export function dataValue(field: EntityField, raw: string | boolean | undefined): unknown {
  if (field.type === 'boolean') return raw === true;
  if (raw === undefined || raw === '' || raw === false) return null;
  const text = String(raw);
  if (field.type === 'money' || field.type === 'number' || field.type === 'integer') return Number(text);
  if (field.type === 'datetime') {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? text : at.toISOString();
  }
  return text;
}
