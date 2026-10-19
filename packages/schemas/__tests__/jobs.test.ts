import { describe, expect, it } from 'vitest';
import {
  JobCardSchema,
  JobCheckSchema,
  JobDefSchema,
  JobTriggerSchema,
  OutputFieldSchema,
  summarizeEvent,
} from '../src';

describe('job cards and jobs', () => {
  it('parses a job card with defaults', () => {
    const c = JobCardSchema.parse({ mission: 'Reply to enquiries.' });
    expect(c.never).toEqual([]);
    expect(c.customer_facing).toBe(false);
    expect(c.trial_days).toBe(14);
    expect(c.escalate).toEqual([]);
    expect(c.forbid).toEqual([]);
  });

  it('rejects a trigger with two kinds', () => {
    expect(JobTriggerSchema.safeParse({ manual: {}, schedule: { time: '09:00' } }).success).toBe(false);
    expect(JobTriggerSchema.safeParse({ manual: {} }).success).toBe(true);
  });

  it('needs options for a choice field', () => {
    expect(OutputFieldSchema.safeParse({ name: 'kind', type: 'choice' }).success).toBe(false);
    expect(OutputFieldSchema.safeParse({ name: 'kind', type: 'choice', options: ['a'] }).success).toBe(true);
  });

  it('needs exactly one of max or min on a limit check', () => {
    const base = { on_fail: 'stop', message: 'x' };
    expect(JobCheckSchema.safeParse({ ...base, limit: { value: 'a' } }).success).toBe(false);
    expect(JobCheckSchema.safeParse({ ...base, limit: { value: 'a', max: 1, min: 0 } }).success).toBe(false);
    expect(JobCheckSchema.safeParse({ ...base, limit: { value: 'a', max: 1 } }).success).toBe(true);
  });

  it('needs as on a calc check', () => {
    expect(JobCheckSchema.safeParse({ calc: { expr: 'a + b' }, on_fail: 'stop', message: 'x' }).success).toBe(false);
    expect(JobCheckSchema.safeParse({ calc: { expr: 'a + b' }, on_fail: 'stop', message: 'x', as: 'total' }).success).toBe(true);
  });

  it('parses a full job', () => {
    const j = JobDefSchema.parse({
      id: 'rent-reminder',
      name: 'Rent reminder',
      description: 'Reminds tenants of overdue rent.',
      agent: 'collector',
      trigger: { list: { list: 'rent', due: { overdue: { date: 'dueDate' } } } },
      steps: [
        { read: { as: 'item', from: 'trigger' } },
        { ai: { as: 'draft', task: 'Write a reminder.', output: [{ name: 'text', type: 'text' }] } },
        { check: { escalate: { text: 'draft' }, on_fail: 'person', message: 'Needs a person.' } },
        { act: { as: 'sent', tool: 'messages.send', args: { text: '{draft.text}' } } },
      ],
    });
    expect(j.daily_cap).toBe(50);
  });

  it('summarizes job events in plain words', () => {
    const s = summarizeEvent('job.escalated', { job: 'Rent reminder', label: 'Emergencies' });
    expect(s).toContain('Rent reminder');
    expect(s).toContain('Emergencies');
    expect(s).not.toMatch(/\w\.\w/);
  });

  it('says when a job reached its daily limit, instead of calling it switched off', () => {
    expect(summarizeEvent('job.switched', { job: 'Rent reminder', enabled: true, dailyCap: 20, cap: true })).toBe('Rent reminder reached its daily limit of 20 runs');
    expect(summarizeEvent('job.switched', { job: 'Rent reminder', enabled: true, dailyCap: 1, cap: true })).toBe('Rent reminder reached its daily limit of 1 run');
    expect(summarizeEvent('job.switched', { job: 'Rent reminder', enabled: false })).toBe('Rent reminder switched off');
  });
});
