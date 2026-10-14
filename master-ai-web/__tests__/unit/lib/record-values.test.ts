import { describe, expect, it } from 'vitest';
import type { EntityField } from '@onehuman/schemas';
import { changedData, dataValue, formValue } from '../../../src/lib/record-values';

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

describe('changedData', () => {
  const f = (name: string, type: EntityField['type']): EntityField => ({ name, label: name, type, required: false });
  const fields = [f('at', 'datetime'), f('local', 'datetime'), f('ok', 'boolean'), f('n', 'number'), f('t', 'string')];
  const initial = { at: '2026-10-14T22:36:04.792Z', local: '2026-10-14T10:00', n: 5, t: 'hello' };
  const start = () => Object.fromEntries(fields.map((x) => [x.name, formValue(x, initial[x.name as keyof typeof initial])]));

  it('sends nothing for fields the person did not touch', () => {
    expect(changedData(fields, start(), initial)).toEqual({});
  });

  it('sends only a changed number, as a number', () => {
    expect(changedData(fields, { ...start(), n: '7' }, initial)).toEqual({ n: 7 });
  });

  it('sends a cleared text field as null', () => {
    expect(changedData(fields, { ...start(), t: '' }, initial)).toEqual({ t: null });
  });
});
