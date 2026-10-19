import { describe, expect, it } from 'vitest';
import { fillTemplate, resolvePath } from '../../src/jobs';

describe('fillTemplate', () => {
  it('returns the raw value for a lone placeholder', () => {
    expect(fillTemplate('{{item.amount}}', { item: { amount: 500 } })).toEqual({ value: 500, missing: [] });
  });
  it('interpolates and lists missing', () => {
    expect(fillTemplate('Rent for {{item.unit}} due {{item.due}}', { item: { unit: 'A-2' } })).toEqual({
      value: 'Rent for A-2 due ',
      missing: ['item.due'],
    });
  });
  it('fills nested objects and arrays', () => {
    expect(fillTemplate({ a: { b: '{{x}}' }, l: ['{{x}}', 1] }, { x: 'hi' })).toEqual({
      value: { a: { b: 'hi' }, l: ['hi', 1] },
      missing: [],
    });
  });
});

describe('resolvePath', () => {
  it('walks arrays by index', () => {
    expect(resolvePath({ rows: [{ x: 1 }] }, 'rows.0.x')).toBe(1);
  });
  it('returns undefined when absent', () => {
    expect(resolvePath({}, 'a.b')).toBeUndefined();
  });
});
