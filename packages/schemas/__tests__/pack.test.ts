import { describe, expect, it } from 'vitest';
import { summarizeEvent } from '../src/events';
import { CheckSchema, FollowUpSchema, PackSchema, RegisterSchema, RoutineTemplateSchema } from '../src/pack';

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

describe('collection routines', () => {
  const base = { id: 'todays-bills', name: "Today's bills", description: 'The AI calls for the day’s bills.' };

  it('takes collect instead of questions, with its defaults', () => {
    const t = RoutineTemplateSchema.parse({ ...base, collect: { list: 'bills', ask: ['billNo', 'total'] } });
    expect(t.questions).toEqual([]);
    expect(t.collect).toEqual({ list: 'bills', ask: ['billNo', 'total'], defaults: {}, max_items: 15 });
  });

  it('refuses both questions and collect, and neither', () => {
    const q = { key: 'people', label: 'People', ask: 'How many people?', type: 'number' };
    expect(RoutineTemplateSchema.safeParse({ ...base, questions: [q], collect: { list: 'bills', ask: ['billNo'] } }).success).toBe(false);
    expect(RoutineTemplateSchema.safeParse(base).success).toBe(false);
  });

  it('caps the items one call takes at 25', () => {
    expect(RoutineTemplateSchema.safeParse({ ...base, collect: { list: 'bills', ask: ['billNo'], max_items: 26 } }).success).toBe(false);
  });
});

describe('follow-ups on a list', () => {
  const party = {
    id: 'unpaid-bills',
    label: 'Unpaid bills → the party',
    who: 'party',
    due: { overdue: { date: 'dueDate' } },
    phone: { ref: 'party', field: 'phone' },
    contact: { ref: 'party', field: 'name' },
    about: ['billNo', 'total'],
  };

  it('fills in the defaults', () => {
    expect(FollowUpSchema.parse(party)).toMatchObject({ due: { overdue: { date: 'dueDate', grace_days: 0 } }, find_out: [], max_tries: 3 });
  });

  it('needs a phone and a contact to call a party, and a team field to call staff', () => {
    expect(FollowUpSchema.safeParse({ ...party, phone: undefined }).success).toBe(false);
    expect(FollowUpSchema.safeParse({ ...party, staff: { field: 'assignedTo' } }).success).toBe(false);
    const staff = { ...party, who: 'staff', phone: undefined, contact: undefined, staff: { field: 'assignedTo' } };
    expect(FollowUpSchema.safeParse(staff).success).toBe(true);
  });

  it('reads all three ways to find a phone', () => {
    for (const phone of [{ field: 'consigneePhone' }, { ref: 'party', field: 'phone' }, { lookup: 'Customer', match: 'name', value: 'client', field: 'phone' }]) {
      expect(FollowUpSchema.safeParse({ ...party, phone }).success).toBe(true);
    }
  });

  it('keeps follow-ups on a register', () => {
    const r = RegisterSchema.parse({ id: 'bills', entity: 'Bill', follow_ups: [party] });
    expect(r.follow_ups?.[0]?.id).toBe('unpaid-bills');
  });
});

describe('call audit events', () => {
  it('describes the new events in words', () => {
    expect(summarizeEvent('followup.switched', { label: 'Unpaid bills → the party', enabled: true })).toBe('Follow-up switched on: Unpaid bills → the party');
    expect(summarizeEvent('note.created', { speaker: 'Sri Ganesh Traders', title: 'S-1042' })).toBe('Note from a call with Sri Ganesh Traders on S-1042');
    expect(summarizeEvent('note.applied', { title: 'S-1042' })).toBe('Call note applied to S-1042');
    expect(summarizeEvent('note.dismissed', { title: 'S-1042' })).toBe('Call note seen on S-1042');
    expect(summarizeEvent('do_not_call.added', { name: 'Sri Ganesh Traders' })).toBe('Sri Ganesh Traders will not be called again');
    expect(summarizeEvent('followup.restarted', { title: 'S-1042', unblocked: true })).toBe('Follow-up started again for S-1042');
  });
});
