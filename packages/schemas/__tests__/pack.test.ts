import { describe, expect, it } from 'vitest';
import { summarizeEvent } from '../src/events';
import { CheckSchema, PackSchema, RegisterSchema } from '../src/pack';

describe('lists in a pack (registers)', () => {
  it('fills in the defaults', () => {
    expect(RegisterSchema.parse({ id: 'bills', entity: 'Bill' })).toEqual({ id: 'bills', entity: 'Bill', main: true, checks: [] });
  });

  it('reads every kind of check, with its defaults', () => {
    const checks = [
      { missing: ['party'] },
      { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'] } },
      { limit: { fields: ['outstanding'], max: 'creditLimit' } },
      { limit: { fields: ['amount'], max: 2000 }, when: { mode: ['cash'] }, why: 'no 80G above ₹2,000 in cash' },
      { duplicate: ['billNo', 'party'] },
      { overdue: { date: 'dueDate' }, when: { paymentStatus: ['unpaid'] } },
      { expiring: { date: 'insuranceValidUntil', days: 30 } },
    ].map((c) => CheckSchema.parse(c));
    expect(checks[1]).toEqual({ adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: [], tolerance: 1 } });
    expect(checks[2]).toEqual({ limit: { fields: ['outstanding'], max: 'creditLimit', factor: 1 } });
    expect(checks[3]).toMatchObject({ when: { mode: ['cash'] }, why: 'no 80G above ₹2,000 in cash' });
    expect(checks[5]).toEqual({ overdue: { date: 'dueDate', grace_days: 0 }, when: { paymentStatus: ['unpaid'] } });
  });

  it('takes conditions as values, above / below, filled or blank', () => {
    const when = { a: ['x', 1, true], b: { above: 0 }, c: { below: 5 }, d: 'filled', e: 'blank' };
    expect(CheckSchema.parse({ missing: ['f'], when }).when).toEqual(when);
  });

  it('refuses a limit with both max and min, or neither', () => {
    expect(CheckSchema.safeParse({ limit: { fields: ['a'], max: 1, min: 0 } }).success).toBe(false);
    expect(CheckSchema.safeParse({ limit: { fields: ['a'] } }).success).toBe(false);
  });

  it('refuses unknown keys, so a typo in a pack fails its test instead of being ignored', () => {
    expect(RegisterSchema.safeParse({ id: 'bills', entity: 'Bill', colums: ['x'] }).success).toBe(false);
    expect(CheckSchema.safeParse({ overdue: { date: 'dueDate', grace: 2 } }).success).toBe(false);
    expect(CheckSchema.safeParse({ missing: ['a'], wen: { a: ['x'] } }).success).toBe(false);
  });

  it('gives a pack no lists unless it names some', () => {
    expect(PackSchema.parse({ id: 'p', version: '1.0.0', name: 'P', description: 'P' }).registers).toEqual([]);
  });
});

describe('audit summaries for list changes', () => {
  it('says what happened in words', () => {
    expect(summarizeEvent('record.updated', { label: 'Bill', title: 'S-1042' })).toBe('Bill S-1042 changed');
    expect(summarizeEvent('record.checked', { label: 'Bill', title: 'S-1042' })).toBe('Bill S-1042 checked');
    expect(summarizeEvent('record.removed', { label: 'Bill', title: 'S-1042', reason: 'entered twice' })).toBe('Bill S-1042 removed: entered twice');
    expect(summarizeEvent('record.samples_removed', { count: 12 })).toBe('Removed 12 sample items');
  });
});
