import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { dataValue, formValue } from '../../../src/lib/record-values';

const field = (type: EntityField['type']): EntityField => ({ name: 'x', label: 'X', type, required: false });

describe('form values', () => {
  it('round-trips a date-time through the local-time input', () => {
    const iso = '2026-10-14T09:30:00.000Z';
    expect(dataValue(field('datetime'), formValue(field('datetime'), iso))).toBe(iso);
  });

  it('stores numbers as numbers, blanks as null and yes/no as booleans', () => {
    expect(dataValue(field('money'), '48260')).toBe(48260);
    expect(dataValue(field('string'), '')).toBeNull();
    expect(dataValue(field('boolean'), false)).toBe(false);
    expect(formValue(field('boolean'), undefined)).toBe(false);
    expect(formValue(field('date'), '2026-10-14')).toBe('2026-10-14');
    expect(formValue(field('money'), null)).toBe('');
  });
});
