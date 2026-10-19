import { describe, expect, it } from 'vitest';
import { EntityDefSchema, JobDefSchema, RegisterSchema, type JobInput, type ResolvedPack } from '@onehuman/schemas';
import { daysText, runText, triggerKind, triggerText } from '../../../src/jobs/describe';

const pack = {
  entities: [
    EntityDefSchema.parse({ name: 'Tenancy', label: 'Tenancy', plural_label: 'Tenancies', fields: [{ name: 'endDate', label: 'End date', type: 'date' }] }),
    EntityDefSchema.parse({ name: 'JobCard', label: 'Job card', fields: [{ name: 'title', label: 'Title', type: 'text' }] }),
    EntityDefSchema.parse({ name: 'Invoice', label: 'Invoice', fields: [{ name: 'total', label: 'Total', type: 'money' }] }),
  ],
  registers: [RegisterSchema.parse({ id: 'tenancies', entity: 'Tenancy' })],
  lifecycle: { categories: [{ id: 'maintenance', name: 'Maintenance' }, { id: 'billing', name: 'Billing' }, { id: 'noise', name: 'Noise' }] },
} as unknown as ResolvedPack;

const job = (trigger: JobInput['trigger']) =>
  JobDefSchema.parse({ id: 'spec', name: 'Spec job', description: 'A job.', agent: 'front-desk', trigger, steps: [{ read: { as: 'say', from: 'trigger' } }] });

describe('what starts a job, in plain words', () => {
  it('names each kind of trigger the way the Agents page shows it', () => {
    expect(triggerText(pack, job({ schedule: { days: [1, 2, 3, 4, 5, 6], time: '09:00' } }))).toBe('Every Mon–Sat at 09:00');
    expect(triggerText(pack, job({ list: { list: 'tenancies', due: { overdue: { date: 'endDate' } } } }))).toBe('When an item in Tenancies is due');
    expect(triggerText(pack, job({ record: { entity: 'JobCard', on: 'updated' } }))).toBe('When a Job card is updated');
    expect(triggerText(pack, job({ record: { entity: 'Invoice', on: 'created' } }))).toBe('When an Invoice is added');
    expect(triggerText(pack, job({ record: { entity: 'Invoice' } }))).toBe('When an Invoice is added or updated');
    expect(triggerText(pack, job({ request: { categories: ['maintenance'] } }))).toBe('When a request about Maintenance comes in');
    expect(triggerText(pack, job({ request: { categories: ['maintenance', 'billing', 'noise'] } }))).toBe('When a request about Maintenance, Billing or Noise comes in');
    expect(triggerText(pack, job({ manual: {} }))).toBe('When someone runs it');
  });

  it('reads days as ranges when three or more follow on', () => {
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('day');
    expect(daysText([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysText([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(daysText([0, 1, 2, 6])).toBe('Sun–Tue, Sat');
    expect(daysText([5, 6])).toBe('Fri, Sat');
  });

  it('gives the kind of each trigger', () => {
    expect(triggerKind(job({ manual: {} }))).toBe('manual');
    expect(triggerKind(job({ schedule: { time: '07:30' } }))).toBe('schedule');
    expect(triggerKind(job({ request: { categories: ['noise'] } }))).toBe('request');
  });
});

describe('what started one run', () => {
  it('describes a run without ids or JSON', () => {
    const manual = runText(pack, job({ manual: {} }), 'manual', { text: 'Is the lift fixed?', by: '6d1f…' });
    expect(manual).toEqual({ short: 'run now', full: 'Someone ran it by hand and wrote: "Is the lift fixed?"' });
    expect(runText(pack, job({ manual: {} }), 'manual', { text: null }).full).toBe('Someone ran it by hand.');
    expect(runText(pack, job({ schedule: { time: '09:00' } }), 'schedule', { date: '2026-10-19' })).toEqual({
      short: 'scheduled run for 2026-10-19',
      full: 'The scheduled run for 2026-10-19 at 09:00.',
    });
    expect(runText(pack, job({ request: { categories: ['noise'] } }), 'request', { code: 'C-12', title: 'Loud music at night' }).full).toBe(
      'A request came in (C-12): Loud music at night.',
    );
    expect(runText(pack, job({ list: { list: 'tenancies', due: { overdue: { date: 'endDate' } } } }), 'list', { item: { id: 'x' } }).full).toBe('An item in Tenancies is due.');
    expect(runText(pack, job({ record: { entity: 'Invoice' } }), 'record', {}).full).toBe('An Invoice was added or changed.');
  });
});
