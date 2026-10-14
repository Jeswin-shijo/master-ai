import { describe, expect, it } from 'vitest';
import type { CaseFile, ResolvedPack } from '@onehuman/schemas';
import { GENERIC_LIFECYCLE } from '@onehuman/agent-kit';
import { isUniqueViolation } from '../../../src/db/errors';
import { stageWorkflowId } from '../../../src/orchestration/shared';
import { appendInfo, caseReadiness, executeSummary, pauseRefusal } from '../../../src/cases/case-context';

describe('opening cases', () => {
  it('explains that an old workspace needs the update', () => {
    const old = { agents: [{ role: 'booking-coordinator' }] } as unknown as ResolvedPack;
    expect(caseReadiness(old)).toMatch(/platform update/);
    const ready = { agents: [{ role: 'case-coordinator' }], lifecycle: GENERIC_LIFECYCLE } as unknown as ResolvedPack;
    expect(caseReadiness(ready)).toBeNull();
  });

  it('recognises the external-ref unique violation, also when wrapped', () => {
    const pg = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'cases_external_ref_idx' });
    expect(isUniqueViolation(pg, 'cases_external_ref_idx')).toBe(true);
    expect(isUniqueViolation(new Error('Failed query', { cause: pg }), 'cases_external_ref_idx')).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'cases_workspace_number_idx' }, 'cases_external_ref_idx')).toBe(false);
    expect(isUniqueViolation(new Error('boom'), 'cases_external_ref_idx')).toBe(false);
  });

  it('appends more details to the request words without touching the original', () => {
    const file: CaseFile = {
      request: { title: 'New connection', summary: 'New connection', requester: { name: 'Lakshmi' }, source: 'owner', receivedAt: '2026-10-13T04:30:00Z', text: 'New connection for my house' },
    };
    const next = appendInfo(file, 'Asha Owner', 'Property tax receipt attached', new Date('2026-10-13T04:30:00Z'));
    expect(next.request!.text).toContain('New connection for my house\n\nMore details from Asha Owner');
    expect(next.request!.text).toContain('Property tax receipt attached');
    expect(file.request!.text).toBe('New connection for my house');
  });

  it('names stage workflows by case, stage and attempt', () => {
    expect(stageWorkflowId('c1', 'execute', 2)).toBe('case-c1-execute-2');
  });
});

describe('kill switch and new requests', () => {
  it('refuses people in the app, who can resume it themselves', () => {
    expect(pauseRefusal('owner', { tenant: true, workspace: false })).toMatch(/kill switch/);
    expect(pauseRefusal('staff', { tenant: false, workspace: true })).toMatch(/paused/);
  });

  it('keeps requests from outside, which wait until the company resumes', () => {
    for (const source of ['customer', 'system', 'partner'] as const) {
      expect(pauseRefusal(source, { tenant: true, workspace: true })).toBeNull();
    }
  });

  it('refuses nobody while nothing is paused', () => {
    expect(pauseRefusal('owner', { tenant: false, workspace: false })).toBeNull();
  });
});

describe('what stage 6 says about its work', () => {
  const report = (done: string[] = [], attention: string[] = []) => ({ done, attention });

  it('says the work is done, with the first thing done', () => {
    expect(executeSummary('completed', report(['Recorded the accident']))).toBe('The work is done: Recorded the accident');
    expect(executeSummary('completed', report())).toBe('The work is done.');
  });

  it('says work that failed, or was still going when it stopped, stopped before it finished', () => {
    expect(executeSummary('failed', report())).toBe('The work stopped before it finished.');
    expect(executeSummary('running', report([], ['Call Meera about LN-07731']))).toBe('The work stopped before it finished: Call Meera about LN-07731');
  });

  it('words the other endings for people, never with underscores', () => {
    expect(executeSummary('partially_completed', report([], ['Ask the bank for the statement']))).toBe('Part of the work is done: Ask the bank for the statement');
    expect(executeSummary('cancelled', report())).toBe('The work was cancelled.');
  });
});
