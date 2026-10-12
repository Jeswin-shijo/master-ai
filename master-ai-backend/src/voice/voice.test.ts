import { describe, expect, it } from 'vitest';
import { scriptedTurn, simulatedReply, type CallContext } from './engine';
import { followUpTime, nextCallableTime, parseDue, speakable } from './time';

// Monday 12 Oct 2026, 10:00 IST
const NOW = new Date('2026-10-12T04:30:00Z');
const ist = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : null);

describe('parseDue', () => {
  it.each([
    ['by tomorrow 5 pm', '2026-10-13T17:00'],
    ['today evening', '2026-10-12T18:00'],
    ['I can do it by Friday', '2026-10-16T18:00'],
    ['day after tomorrow morning', '2026-10-14T10:00'],
    ['in 3 days', '2026-10-15T18:00'],
    ['by 3:30 pm', '2026-10-12T15:30'],
    ['by 9 am', '2026-10-13T09:00'],
  ])('%s → %s IST', (text, expected) => {
    expect(ist(parseDue(text, NOW))).toBe(expected);
  });

  it('returns null when no time is mentioned', () => {
    expect(parseDue('sure, will do', NOW)).toBeNull();
  });

  it('handles "in N hours"', () => {
    expect(parseDue('in 2 hours', NOW)!.getTime() - NOW.getTime()).toBe(2 * 3_600_000);
  });
});

describe('calling windows', () => {
  const hours = { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '19:00' };

  it('calls now inside working hours', () => {
    expect(nextCallableTime(NOW, hours)).toEqual(NOW);
  });

  it('waits until the next working morning', () => {
    const late = new Date('2026-10-12T15:00:00Z'); // 20:30 IST
    expect(ist(nextCallableTime(late, hours))).toBe('2026-10-13T09:00');
  });

  it('skips days off', () => {
    const saturdayNight = new Date('2026-10-17T15:00:00Z'); // Sat 20:30 IST; Sunday off
    expect(ist(nextCallableTime(saturdayNight, hours))).toBe('2026-10-19T09:00');
  });

  it('never calls outside 9:00–21:00 even if hours say so', () => {
    const early = new Date('2026-10-12T01:00:00Z'); // 06:30 IST
    expect(ist(nextCallableTime(early, { days: [1], start: '06:00', end: '23:00' }))).toBe('2026-10-12T09:00');
  });

  it('follows up halfway to the deadline', () => {
    const due = new Date(NOW.getTime() + 24 * 3_600_000);
    expect(followUpTime(NOW, due).getTime() - NOW.getTime()).toBe(12 * 3_600_000);
  });

  it('speaks dates naturally', () => {
    expect(speakable(new Date('2026-10-13T11:30:00Z'))).toMatch(/Tuesday.*13 October.*5 pm/);
  });
});

describe('scripted call conversation', () => {
  const base: CallContext = {
    tenantId: 't',
    goalId: 'g',
    taskId: 'k',
    companyName: 'Kerala Trails',
    ownerName: 'Asha',
    staff: { name: 'Ravi Kumar', title: 'Operations manager' },
    stage: 'assign',
    task: { title: 'Inspect the Munnar rooms', instructions: 'Inspect the Munnar rooms before the group arrives.', dueAt: null },
    transcript: [],
  };

  it('assign: accepts with the stated deadline', () => {
    const r = scriptedTurn(base, 'Yes, I can do it by tomorrow 5 pm', NOW);
    expect(r).toMatchObject({ end: true, outcome: 'accepted' });
    expect(ist(r.dueAt)).toBe('2026-10-13T17:00');
  });

  it('assign: "no problem" is not a decline', () => {
    expect(scriptedTurn(base, 'No problem, will do', NOW).outcome).toBe('accepted');
  });

  it('assign: declines', () => {
    expect(scriptedTurn(base, "Sorry, I can't, I'm on leave this week", NOW)).toMatchObject({ outcome: 'declined', end: true });
  });

  it('assign: asks again when unclear, then gives up', () => {
    const first = scriptedTurn(base, 'Hmm, what?', NOW);
    expect(first).toMatchObject({ end: false, outcome: null });
    const second = scriptedTurn({ ...base, transcript: [{ speaker: 'person', text: 'Hmm, what?', at: '' }] }, 'hmm', NOW);
    expect(second).toMatchObject({ end: true, outcome: 'unclear' });
  });

  it('follow-up: on track, blocked, done, more time', () => {
    const f = { ...base, stage: 'follow_up' as const, task: { ...base.task, dueAt: new Date('2026-10-13T12:30:00Z') } };
    expect(scriptedTurn(f, 'Going well, on track', NOW).outcome).toBe('on_track');
    expect(scriptedTurn(f, 'There is a problem, the keys are missing', NOW).outcome).toBe('blocked');
    expect(scriptedTurn(f, 'Already finished it', NOW).outcome).toBe('done');
    expect(scriptedTurn(f, 'I need more time, by Friday', NOW).outcome).toBe('needs_more_time');
  });

  it('confirm: done vs not done', () => {
    const c = { ...base, stage: 'confirm' as const };
    expect(scriptedTurn(c, "Yes, it's done, no issues", NOW).outcome).toBe('done');
    expect(scriptedTurn(c, 'Not yet, still pending', NOW).outcome).toBe('not_done');
  });

  it('the simulated team member completes the whole cadence', () => {
    for (const stage of ['assign', 'follow_up', 'confirm'] as const) {
      const ctx = { ...base, stage };
      expect(scriptedTurn(ctx, simulatedReply(ctx), NOW).outcome).toBe({ assign: 'accepted', follow_up: 'on_track', confirm: 'done' }[stage]);
    }
  });
});
