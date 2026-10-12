import { describe, expect, it } from 'vitest';
import type { RoutineQuestion } from '@onehuman/schemas';
import { checkinSummary, flagsOf, parseAnswer, scriptedCheckinTurn, simulatedCheckinReply, type CheckinContext } from './checkin-engine';
import { istDate, nextRunAt } from './time';

const questions: RoutineQuestion[] = [
  { key: 'people', label: 'People on the job', ask: 'How many people worked on the job today?', type: 'number', unit: 'people', required: true, flag: false },
  { key: 'workDone', label: 'Work done', ask: 'What work got done today?', type: 'text', required: true, flag: false },
  { key: 'progress', label: 'Progress', ask: 'How far along is the work now, in percent?', type: 'percent', required: true, flag: false },
  { key: 'shortages', label: 'Running short', ask: 'Is anything running short?', type: 'text', required: true, flag: true },
];
const ctx = (over: Partial<CheckinContext> = {}): CheckinContext => ({
  tenantId: 't',
  companyName: 'Kerala Builders',
  ownerName: 'Asha',
  staff: { name: 'Ravi Kumar', title: 'Site supervisor' },
  routine: { name: 'Daily work report', questions },
  values: {},
  retries: {},
  transcript: [],
  ...over,
});
const q = (key: string) => questions.find((x) => x.key === key)!;

describe('parseAnswer', () => {
  it.each([
    ['12 people today', 12],
    ['twelve', 12],
    ['about twenty five', 25],
    ['a dozen', 12],
  ])('number: %s → %s', (text, value) => expect(parseAnswer(q('people'), text)).toEqual({ ok: true, value }));

  it.each([
    ['About 60 percent', 60],
    ['sixty percent', 60],
    ['half done', 50],
    ['almost done', 90],
    ['it is finished', 100],
  ])('percent: %s → %s', (text, value) => expect(parseAnswer(q('progress'), text)).toEqual({ ok: true, value }));

  it('treats "nothing / all good" as no problem, and keeps real problems', () => {
    expect(parseAnswer(q('shortages'), 'No, we have enough of everything.')).toEqual({ ok: true, value: 'none' });
    expect(parseAnswer(q('shortages'), 'All good')).toEqual({ ok: true, value: 'none' });
    expect(parseAnswer(q('shortages'), 'Yes, cement is running low')).toEqual({ ok: true, value: 'Cement is running low' });
  });

  it('refuses a number it cannot hear', () => expect(parseAnswer(q('people'), 'quite a lot')).toEqual({ ok: false }));
});

describe('scripted check-in call', () => {
  it('asks each question in turn and closes with what it noted', () => {
    let c = ctx();
    const replies = ['14 people', 'Finished the slab shuttering', 'About 60 percent', 'Cement is running low, need 50 bags'];
    const said: string[] = [];
    for (const r of replies) {
      const t = scriptedCheckinTurn(c, r);
      said.push(t.say);
      c = { ...c, values: t.values, retries: t.retries };
      if (t.end) break;
    }
    expect(said[0]).toBe('Got it, 14 people. What work got done today?');
    expect(said[2]).toBe('Noted, 60 percent. Is anything running short?');
    expect(said[3]).toBe("Thank you, Ravi. I've noted: 14 people, 60% done, Running short: Cement is running low, need 50 bags. I'll pass the problems to Asha. Have a good evening.");
    expect(c.values).toEqual({ people: 14, workDone: 'Finished the slab shuttering', progress: 60, shortages: 'Cement is running low, need 50 bags' });
    expect(flagsOf(questions, c.values)).toEqual(['Running short: Cement is running low, need 50 bags']);
    expect(checkinSummary(questions, c.values)).toBe('14 people · 60% done · Running short: Cement is running low, need 50 bags');
  });

  it('asks again once when a number is unclear, then moves on', () => {
    const first = scriptedCheckinTurn(ctx(), 'quite a lot');
    expect(first).toMatchObject({ end: false, say: 'Sorry, I need a number for that. How many people worked on the job today?' });
    const second = scriptedCheckinTurn(ctx({ retries: first.retries }), 'many');
    expect(second.values.people).toBeNull();
    expect(second.say).toMatch(/What work got done today\?$/);
  });

  it('ends politely when they are busy, to call back', () => {
    expect(scriptedCheckinTurn(ctx(), 'I am driving, call me later')).toMatchObject({ end: true, callBack: true });
  });

  it('simulated staff answer every question so the whole report fills in', () => {
    let c = ctx();
    for (let i = 0; i < 6; i++) {
      const t = scriptedCheckinTurn(c, simulatedCheckinReply(c));
      c = { ...c, values: t.values, retries: t.retries };
      if (t.end) break;
    }
    expect(Object.keys(c.values).sort()).toEqual(['people', 'progress', 'shortages', 'workDone']);
    expect(typeof c.values.people).toBe('number');
  });
});

describe('routine time', () => {
  // Monday 12 Oct 2026, 10:00 IST
  const now = new Date('2026-10-12T04:30:00Z');
  it('gives the India date', () => {
    expect(istDate(now)).toBe('2026-10-12');
    expect(istDate(new Date('2026-10-12T19:00:00Z'))).toBe('2026-10-13'); // 00:30 IST next day
  });
  it('finds the next run on the routine days', () => {
    expect(nextRunAt([1, 2, 3, 4, 5, 6], '18:00', now)?.toISOString()).toBe('2026-10-12T12:30:00.000Z'); // today 6 pm
    expect(nextRunAt([0], '09:30', now)?.toISOString()).toBe('2026-10-18T04:00:00.000Z'); // Sunday
    expect(nextRunAt([1], '09:00', now)?.toISOString()).toBe('2026-10-19T03:30:00.000Z'); // next Monday
  });
});
