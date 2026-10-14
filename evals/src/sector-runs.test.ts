import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeForSector } from '@onehuman/agent-kit';
import { ORG_TYPES, SECTORS, type CaseDetail } from '@onehuman/schemas';
import { loadPackRegistry, loadSuites, runSuite } from './runner.ts';
import { asSent, caseProblems, expectationFor, findCase, formatSummary, LIVE_RUN_IDS, packFor, SECTOR_RUNS, type RunExpectation } from './sector-runs.ts';

const registry = loadPackRegistry(fileURLToPath(new URL('../../packs/', import.meta.url)));
const suites = loadSuites(fileURLToPath(new URL('../suites/', import.meta.url)));
const NOW = new Date('2026-01-01T09:00:00Z');
const ownWords = SECTOR_RUNS.filter((r) => !registry.has(r.orgType));

describe('the organizations pnpm e2e:sectors sets up', () => {
  it("cover every ready-made type once, and one typed in the owner's words per sector", () => {
    const ids = SECTOR_RUNS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ORG_TYPES.map((t) => t.id).filter((id) => SECTOR_RUNS.filter((r) => r.orgType === id).length !== 1)).toEqual([]);
    expect(SECTORS.map((s) => ownWords.filter((r) => r.sector === s.id).length)).toEqual([1, 1, 1, 1, 1]);
    expect(LIVE_RUN_IDS.map((id) => SECTOR_RUNS.find((r) => r.id === id)?.sector).sort()).toEqual(SECTORS.map((s) => s.id).sort());
  });

  it.each(ownWords.map((r) => [r.id, r] as const))("%s, typed in the owner's words, builds on the expected type", (_id, run) => {
    expect(composeForSector(run.orgType, run.sector, [...registry.values()]).basedOn).toBe(run.basedOn);
    expect(packFor(run, registry).lineage).toContain(run.basedOn);
  });

  it.each(SECTOR_RUNS.filter((r) => r.suiteCase).map((r) => [r.id, r] as const))("%s: the request, sent through its door, gets the test set's answers offline", (_id, run) => {
    const c = asSent(run, findCase(suites, run.suiteCase!));
    const card = runSuite(packFor(run, registry), { pack: run.suiteCase!.pack, cases: [c] }, NOW);
    expect(card.failures).toEqual([]);
    // Both gates run, so all eight stages do real work.
    expect(c.expect.approval?.required && c.expect.signoff?.required).toBe(true);
  });

  it('sends the door the right source, and the public form never carries an amount', () => {
    const byEntry = (entry: string) => SECTOR_RUNS.find((r) => r.entry === entry && r.suiteCase)!;
    const app = byEntry('app');
    const form = SECTOR_RUNS.find((r) => r.entry === 'form' && r.suiteCase && findCase(suites, r.suiteCase).amount_inr)!;
    const api = byEntry('api');
    expect(asSent(app, findCase(suites, app.suiteCase!)).source).toBe('owner');
    expect(asSent(form, findCase(suites, form.suiteCase!))).toMatchObject({ source: 'customer' });
    expect(asSent(form, findCase(suites, form.suiteCase!)).amount_inr).toBeUndefined();
    expect(['system', 'partner']).toContain(asSent(api, findCase(suites, api.suiteCase!)).source);
  });

  it('only checks that a request of our own finishes', () => {
    const own = SECTOR_RUNS.filter((r) => !r.suiteCase);
    expect(own.length).toBeGreaterThan(0);
    for (const r of own) {
      expect(r.request!.length).toBeGreaterThan(20);
      expect(Object.keys(expectationFor(r, packFor(r, registry), suites))).toEqual(['stageNames']);
    }
  });

  it('expects the stage names, category, priority and the roles the gates go to', () => {
    const run = SECTOR_RUNS.find((r) => r.id === 'power-plant')!;
    const want = expectationFor(run, packFor(run, registry), suites);
    expect(want).toMatchObject({ category: expect.any(String), priority: 'P1', approval: 'plant-head', signoff: 'safety-officer' });
    expect(want.stageNames).toHaveLength(8);
  });
});

const WANT: RunExpectation = {
  stageNames: ['Request', 'Review', 'Classify', 'Assign', 'Approve', 'Do the work', 'Close', 'Report'],
  category: 'breakdown',
  priority: 'P1',
  approval: 'safety-officer',
  signoff: 'owner',
};
const TOOLS = ['records.update', 'booking.confirm'];
const GATES = [
  { kind: 'case_gate', stage: 'approve', approver: 'safety-officer', status: 'approved', summary: 'Approve hot work for WO-0001', reasons: ['Hot work needs the safety officer.'] },
  { kind: 'case_gate', stage: 'close', approver: 'owner', status: 'approved', summary: 'Sign off WO-0001', reasons: [] },
];

function detail(over: { status?: string; outcome?: string; category?: string; priority?: string; names?: string[]; stageStatus?: string; approvals?: object[]; text?: string; summaries?: string[] } = {}): CaseDetail {
  const names = over.names ?? WANT.stageNames;
  return {
    case: { code: 'WO-0001', status: over.status ?? 'closed', outcome: over.outcome ?? 'Resolved.', category: over.category ?? 'breakdown', priority: over.priority ?? 'P1' },
    approvals: over.approvals ?? GATES,
    report: {
      text: over.text ?? 'WO-0001 was resolved within its deadline.',
      stages: names.map((name, i) => ({ name, status: over.stageStatus ?? 'done', summary: over.summaries?.[i] ?? `${name} done.` })),
    },
  } as unknown as CaseDetail;
}

describe('caseProblems', () => {
  it('passes a case that went as expected', () => {
    expect(caseProblems(detail(), WANT, TOOLS, 'strict')).toEqual({ problems: [], differences: [] });
  });

  it('fails a wrong category, priority or gate role in a strict run', () => {
    const d = detail({ category: 'routine', priority: 'P3', approvals: [{ ...GATES[0], approver: 'owner' }] });
    expect(caseProblems(d, WANT, TOOLS, 'strict').problems).toEqual([
      'category routine, expected breakdown',
      'priority P3, expected P1',
      'approval went to owner, expected safety-officer',
      'sign-off went to nobody, expected owner',
    ]);
  });

  it("reports a live model's different judgement instead of failing on it", () => {
    expect(caseProblems(detail({ category: 'routine' }), WANT, TOOLS, 'live')).toEqual({ problems: [], differences: ['category routine, expected breakdown'] });
  });

  it('fails a case that did not finish, or a stage that failed, in either mode', () => {
    expect(caseProblems(detail({ status: 'escalated', outcome: 'Nobody signed off.' }), WANT, TOOLS, 'live').problems).toContain('ended escalated: Nobody signed off.');
    expect(caseProblems(detail({ stageStatus: 'failed' }), WANT, TOOLS, 'strict').problems).toContain('Request is failed');
  });

  it('fails stage names other than the pack’s', () => {
    const names = [...WANT.stageNames.slice(0, 7), 'Close-out report'];
    expect(caseProblems(detail({ names }), WANT, TOOLS, 'live').problems[0]).toMatch(/^stage names .*Close-out report/);
  });

  it('fails words people read that name a tool, show an id or show raw data', () => {
    const d = detail({
      text: 'Ran records.update on the order.',
      summaries: ['Approved by 3f2b9c1e-8a4d-4c2e-9b7a-1d2e3f4a5b6c.', '{"category":"x"}', 'Booked the hotel.Confirmed by phone.', 'Done, then booking.confirm.'],
    });
    const { problems } = caseProblems(d, WANT, TOOLS, 'strict');
    expect(problems.filter((p) => p.includes('names the tool records.update'))).toHaveLength(1);
    expect(problems.filter((p) => p.includes('names the tool booking.confirm'))).toHaveLength(1);
    expect(problems.filter((p) => p.includes('shows an id'))).toHaveLength(1);
    expect(problems.filter((p) => p.includes('shows raw data'))).toHaveLength(1);
    expect(problems).toHaveLength(4);
  });

  it('reads approval summaries and reasons too', () => {
    const approvals = [{ ...GATES[0], reasons: ['Earned autonomy: message.send was approved 5 times.'] }, GATES[1]!];
    expect(caseProblems(detail({ approvals }), WANT, [...TOOLS, 'message.send'], 'strict').problems).toEqual([
      '“Earned autonomy: message.send was approved 5 times.” names the tool message.send',
    ]);
  });
});

describe('formatSummary', () => {
  const [a, b, c] = SECTOR_RUNS;

  it('lists every organization, and one failure or error fails the run', () => {
    const { text, ok } = formatSummary([
      { run: a!, code: 'WO-0001', seconds: 41, problems: [], differences: [] },
      { run: b!, code: 'WO-0002', seconds: 50, problems: ['category routine, expected breakdown'], differences: [] },
      { run: c!, seconds: 300, problems: [], differences: [], error: 'CN-0001 stayed at Execution (in_progress)' },
    ]);
    expect(ok).toBe(false);
    expect(text).toContain(`✓ ${a!.id}`);
    expect(text).toContain(`✗ ${b!.id}`);
    expect(text).toContain('category routine, expected breakdown');
    expect(text).toContain(`✗ ${c!.id}`);
    expect(text).toContain('CN-0001 stayed at Execution (in_progress)');
    expect(text).toContain('3 organizations: 1 passed, 2 failed');
  });

  it("passes a live run whose model judged differently, and shows what it judged", () => {
    const { text, ok } = formatSummary([{ run: a!, code: 'WO-0001', seconds: 41, problems: [], differences: ['priority P2, expected P1'] }]);
    expect(ok).toBe(true);
    expect(text).toContain('priority P2, expected P1');
  });
});
