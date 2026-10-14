# Plan 7 — Final pass: every organization type end to end, CI, decision records and README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove every one of the 15 ready-made organization types (and one typed in the owner's own words per sector) end to end against the real stack, run that proof plus the browser tests in CI, add Google Gemini as an optional second model provider so the live-model run can happen with a Google key, and bring the docs (ADR 0009, 0010 and 0011, CLAUDE.md, README, a known-gaps list) in line with what was built.

**Architecture:** The list of organizations to run, the case each one sends and the checks on the finished case are pure code in `evals/src/sector-runs.ts`, next to the test sets they read, and are unit-tested there (including that every chosen request gets its test set's answers offline). A new script, `master-ai-backend/scripts/sectors.mts` (`pnpm e2e:sectors`), drives a running API + worker through those organizations in five parallel lanes, one per sector, using helpers moved out of `smoke.ts` into `scripts/lib.ts`. Gemini plugs in behind the existing LLM gateway (`LlmService`): the request and response mapping is pure code in `packages/agent-kit/src/gemini.ts`, shared by the backend and `pnpm evals:live` the way prices already are; Claude stays the default. CI's end-to-end job becomes one script, `infra/ci/e2e.sh`, that a developer can run locally the same way. The docs are guarded by a test that checks links, the decision-record list, the commands and the organization types.

**Tech Stack:** TypeScript 5.9, tsx, vitest 5, Playwright 1.63 (Chromium), GitHub Actions, the `@onehuman/sdk` client, `@anthropic-ai/sdk` 0.133, `@google/genai` 2.24.0 (new).

**Spec:** [docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md](../specs/2026-10-12-org-types-and-case-lifecycle-design.md). Plan 7's row in the roadmap at the end of [plan 1](2026-10-13-plan-1-lifecycle-foundations.md): "ADR 0009 and 0010, README, `CLAUDE.md` rules, the full end-to-end run across every sector, plus the live-model run when a key is set. Ends with: everything green; the user reviews."

## Global Constraints

- Every tenant-scoped query goes through `DbService.tenant(tenantId, tx => …)`; every state change appends an audit event in the same transaction. (Only matters if a bug fix below touches the backend.)
- Owners and their clients never see tool names, ids or JSON.
- Agents never decide permissions; approval rules live in pack `policies` and lifecycle rules.
- New dependencies: only `@google/genai`, pinned to `2.24.0` (published 2026-09-22, at least 14 days old), in `master-ai-backend` and `evals`. Every package it pulls in must also be at least 14 days old (Task 4 Step 1 checks the lockfile).
- Claude stays the default provider. Gemini is used only when no Anthropic key is set and `GEMINI_API_KEY` is, or when `LLM_PROVIDER=google`. No caller outside `LlmService` and `evals/src/live.ts` names a provider.
- Run only one `pnpm dev`. Task 5's rehearsal stops it first and starts it again after.
- Push and merge need the user's approval. Commit on the plan branch only.
- Words for people: plain sentences, no tool names. Docs follow the same plain style as the existing ADRs and README.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Deviations from the roadmap (decided while planning)

1. **The full end-to-end run is a new command, `pnpm e2e:sectors`, not a longer smoke test.** The smoke test already runs one organization per sector plus the edge checks; making it run all 20 organizations would double its time and mix two jobs. The new command runs every ready-made type and one own-words type per sector, five sectors in parallel, and CI runs it right after the smoke test.
2. **The spec's CI line "`checks` adds `pnpm evals`" is already true.** The test sets run inside `pnpm turbo run build typecheck test` (the `@onehuman/evals` package's `test` task). No change to the `checks` job.
3. **The live-model run uses Google Gemini.** No `ANTHROPIC_API_KEY` is set on this machine, and on 2026-10-14 the user chose to add Google as a provider for testing rather than get a Claude key. Task 3 makes `pnpm evals:live` survive model errors; Task 4 adds Gemini behind the gateway and to `pnpm evals:live`; `pnpm e2e:sectors` switches to a live mode by itself when the API says it has a model. Task 7 runs both with whichever key is set. The scores then measure Gemini, not the Claude models the product ships with; the run proves the live path works end to end.
4. **A known-gaps list is added** (`docs/known-gaps.md`). The deferred findings from Plans 2–6 are only in session notes today; the final pass puts them in the repository, in plain words, so the user can review and choose.
5. **The eval-leak rule names the right test.** The spec says `pack.test.ts` enforces "eval requests never go into pack examples"; the check actually lives in `evals/src/suites.test.ts` ("keeps its examples out of the test set"). The CLAUDE.md rule names that file.
6. **Gemini is a second provider, recorded as ADR 0011.** The spec's "Out of scope" doesn't mention providers and the README lists "primary LLM providers per data class" as the user's open decision; the user decided to add Google for testing. It goes behind the one gateway (ADR 0005), with per-tier models set by `GEMINI_MODEL_*`. Data-class routing between providers stays open.

## Review Focus

1. **One organization failing or timing out must not hide the others.** Every organization gets a line in the final summary, with its case code and the stage it stopped at, and the run exits non-zero. (Pinned by the `formatSummary` tests in Task 1; the script catches each organization's error in Task 2.)
2. **A real model that judges differently, or asks for more details.** In live mode the run answers a "needs details" question once, then reports the model's different category, priority or approver next to the test set's instead of failing; it fails only on broken behaviour (not finished, a failed stage, wrong stage names, leaked tool names). (Pinned by the live-mode `caseProblems` tests in Task 1 and the needs-details reply in Task 2.)
3. **Words people read never carry tool names, ids or raw data, in all 20 organizations, including own-words packs whose labels are composed.** That covers the report, each stage's summary, and each approval's summary and reasons. (Pinned by the leak tests in Task 1; every run checks it in Task 2.)
4. **A Gemini answer the gateway didn't expect: the model's thinking mixed into the text, a blocked prompt, a tool call cut off at the token limit or malformed, several tool calls at once, or a free key's rate limit.** Each behaves as it does with Claude: thoughts never reach people, a block is a refusal, a cut-off or malformed call never runs, only the first call is taken, and a rate limit falls back to the next tier or the rules, never a crash. (Pinned by the `gemini.test.ts` tests in Task 4; the live run in Task 7 is paced and runs one organization at a time.)
5. **The production web build under Playwright in CI.** CI serves `vite preview` (no dev server, `VITE_API_URL` unset) and must behave like the dev server. (Rehearsed locally with the same script in Task 5.)

## File map

| File | Change |
|---|---|
| `evals/src/sector-runs.ts` | Create: the 20 organizations, the request each sends, its expectations, `caseProblems`, `formatSummary` |
| `evals/src/sector-runs.test.ts` | Create |
| `master-ai-backend/scripts/lib.ts` | Create: helpers moved out of `smoke.ts`, plus `invite` |
| `master-ai-backend/scripts/smoke.ts` | Modify: import the helpers from `lib.ts` |
| `master-ai-backend/scripts/sectors.mts` | Create: `pnpm e2e:sectors` |
| `master-ai-backend/scripts/tsconfig.json` | Create: typecheck the scripts |
| `master-ai-backend/package.json`, `package.json` | Modify: `e2e:sectors` scripts; backend typecheck includes scripts |
| `evals/src/live-lib.ts`, `evals/src/live.ts`, `evals/src/live.test.ts` | Modify: failed calls and refused keys; Gemini; pacing |
| `packages/agent-kit/src/gemini.ts`, `gemini.test.ts`, `pricing.ts`, `index.ts` | Create/modify: the Gemini request and response mapping, Gemini prices |
| `master-ai-backend/src/config.ts`, `src/llm/llm.service.ts`, `src/llm/provider.test.ts`, `src/health.controller.ts`, `src/main.ts`, `src/worker.ts`, `.env.example` | Modify/create: choose the provider, call Gemini |
| `docs/adr/0011-gemini-as-a-second-model-provider.md` | Create |
| `infra/ci/e2e.sh` | Create: the end-to-end job |
| `.github/workflows/ci.yml`, `.gitignore` | Modify |
| `evals/src/docs.test.ts` | Create: docs guard |
| `docs/adr/0009-organization-types-and-the-case-lifecycle.md` | Create |
| `docs/adr/0010-roles-invites-and-gate-approvals.md` | Create |
| `docs/known-gaps.md` | Create |
| `README.md`, `CLAUDE.md` | Modify |

---

### Task 1: The organizations to run, and the checks on a finished case

**Files:**
- Create: `evals/src/sector-runs.ts`
- Test: `evals/src/sector-runs.test.ts`

**Interfaces:**
- Consumes: `loadPackRegistry(dir): Map<string, Pack>`, `loadSuites(dir): EvalSuite[]`, `runSuite(pack, suite, now): Scorecard` and `type EvalSuite` from `evals/src/runner.ts`; `composeForSector(industry, sector, packs): { pack, basedOn, via }`, `resolvePack(pack, lookup): ResolvedPack`, `lifecycleOf(pack): ResolvedLifecycle`, `TOOL_CATALOG` from `@onehuman/agent-kit`; `ORG_TYPES`, `SECTORS`, `type CaseDetail`, `type CaseSource`, `type Pack`, `type ResolvedPack`, `type SectorId` from `@onehuman/schemas`.
- Produces (used by Task 2):
  - `interface SectorRun { id: string; sector: SectorId; orgType: string; basedOn: string; entry: 'app' | 'form' | 'api'; suiteCase?: { pack: string; id: string }; request?: string }`
  - `const SECTOR_RUNS: readonly SectorRun[]` (20 entries) and `const LIVE_RUN_IDS: readonly string[]` (5 ids, one per sector)
  - `type EvalCase = EvalSuite['cases'][number]`
  - `findCase(suites: EvalSuite[], ref: { pack: string; id: string }): EvalCase`
  - `asSent(run: SectorRun, c: EvalCase): EvalCase`
  - `packFor(run: SectorRun, registry: Map<string, Pack>): ResolvedPack`
  - `interface RunExpectation { stageNames: string[]; category?: string; priority?: string; approval?: string | null; signoff?: string | null }`
  - `expectationFor(run: SectorRun, pack: ResolvedPack, suites: EvalSuite[]): RunExpectation`
  - `toolNamesOf(pack: ResolvedPack): string[]`
  - `caseProblems(d: CaseDetail, want: RunExpectation, toolNames: string[], mode: 'strict' | 'live'): { problems: string[]; differences: string[] }`
  - `interface RunResult { run: SectorRun; code?: string; seconds: number; problems: string[]; differences: string[]; error?: string }`
  - `formatSummary(results: RunResult[]): { text: string; ok: boolean }`

The requests were chosen so that each one needs both an approval (stage 5) and a sign-off (stage 7), so all eight stages do real work, and so that the doors vary: the New request button (sent by the owner), the public form (a customer, no amount field) and the intake API (a system or partner). Every chosen request scores fully offline today (`pnpm evals` reports 0 misses in every suite); the third test below proves it still does when sent through its door.

- [ ] **Step 1: Write the failing test**

Create `evals/src/sector-runs.test.ts`:

```ts
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
    const approvals = [{ ...GATES[0], reasons: ['Earned autonomy: message.send was approved 5 times.'] }, GATES[1]];
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/evals exec vitest run src/sector-runs.test.ts`
Expected: FAIL — `Failed to resolve import "./sector-runs.ts"`.

- [ ] **Step 3: Write the implementation**

Create `evals/src/sector-runs.ts`:

```ts
import { composeForSector, lifecycleOf, resolvePack, TOOL_CATALOG } from '@onehuman/agent-kit';
import type { CaseDetail, CaseSource, Pack, ResolvedPack, SectorId } from '@onehuman/schemas';
import type { EvalSuite } from './runner.ts';

/**
 * The organizations `pnpm e2e:sectors` sets up against a running API: every
 * ready-made type, plus one per sector typed in the owner's own words. Each
 * sends one real request from the test sets through the door that request
 * would really use, and expects the test set's answers.
 */
export interface SectorRun {
  /** The ready-made type's pack id, or a short name for an own-words organization. */
  id: string;
  sector: SectorId;
  /** What signup sends: a ready-made pack id, or the owner's own words. */
  orgType: string;
  /** The pack the organization should be built on. */
  basedOn: string;
  /** New request (sent by the owner), the public form (a customer) or the intake API (a system or partner). */
  entry: 'app' | 'form' | 'api';
  /** A request from a test set; its expectations become the run's. */
  suiteCase?: { pack: string; id: string };
  /** A request of our own, where no test set fits. Only checked to finish. */
  request?: string;
}

const ready = (sector: SectorId, id: string, entry: SectorRun['entry'], caseId: string): SectorRun => ({ id, sector, orgType: id, basedOn: id, entry, suiteCase: { pack: id, id: caseId } });

export const SECTOR_RUNS: readonly SectorRun[] = [
  ready('energy-heavy-industry', 'power-plant', 'app', 'lineman-shock'),
  ready('energy-heavy-industry', 'manufacturing-plant', 'app', 'press-hand-injury'),
  ready('energy-heavy-industry', 'construction', 'app', 'low-cubes-owner'),
  { id: 'cement-unit', sector: 'energy-heavy-industry', orgType: 'Cement grinding unit in Satna', basedOn: 'manufacturing-plant', entry: 'api', suiteCase: { pack: 'manufacturing-plant', id: 'kiln-drive-trip' } },
  ready('trade-logistics-tourism', 'logistics', 'api', 'paint-thinner-hazardous'),
  ready('trade-logistics-tourism', 'wholesale-retail', 'api', 'oil-below-reorder'),
  ready('trade-logistics-tourism', 'travel-agency', 'form', 'ooty-cancel-exams'),
  { id: 'cold-storage', sector: 'trade-logistics-tourism', orgType: 'Cold storage warehouse for potatoes', basedOn: 'logistics', entry: 'form', suiteCase: { pack: 'logistics', id: 'wet-cartons-claim' } },
  ready('finance-development', 'lender', 'app', 'truck-repossession'),
  ready('finance-development', 'accounting-firm', 'api', 'nri-remittance-certificate'),
  ready('finance-development', 'ngo', 'api', 'csr-smart-classrooms'),
  { id: 'credit-society', sector: 'finance-development', orgType: 'Cooperative credit society', basedOn: 'lender', entry: 'app', suiteCase: { pack: 'lender', id: 'owner-working-capital' } },
  ready('technology-innovation', 'software-saas', 'app', 'founder-pushes-release'),
  ready('technology-innovation', 'it-services', 'api', 'soc-m365-mail-forwarding'),
  ready('technology-innovation', 'digital-agency', 'form', 'japanese-spam-hacked'),
  {
    id: 'data-annotation',
    sector: 'technology-innovation',
    orgType: 'Data annotation company',
    basedOn: 'sector-technology-innovation',
    entry: 'app',
    request: 'A client says 3,000 of the 20,000 images we labelled last week have wrong boxes around the vehicles. They want them redone by Friday at no charge.',
  },
  ready('public-services', 'hospital', 'app', 'night-ward-fall'),
  ready('public-services', 'education', 'form', 'neet-refund'),
  ready('public-services', 'municipal', 'form', 'property-tax-paid-twice'),
  { id: 'gram-panchayat', sector: 'public-services', orgType: 'Gram panchayat office', basedOn: 'municipal', entry: 'app', suiteCase: { pack: 'municipal', id: 'pothole-work-order' } },
];

/** One organization per sector for the live-model run: a real model answers, so a few cases are enough. */
export const LIVE_RUN_IDS: readonly string[] = ['power-plant', 'travel-agency', 'lender', 'software-saas', 'hospital'];

export type EvalCase = EvalSuite['cases'][number];

export function findCase(suites: EvalSuite[], ref: { pack: string; id: string }): EvalCase {
  const found = suites.find((s) => s.pack === ref.pack)?.cases.find((c) => c.id === ref.id);
  if (!found) throw new Error(`No case ${ref.id} in the ${ref.pack} test set`);
  return found;
}

/** The test-set case as the run sends it: the door decides the source, and the public form has no amount field. */
export function asSent(run: SectorRun, c: EvalCase): EvalCase {
  const { amount_inr, ...rest } = c;
  let source: CaseSource;
  if (run.entry === 'app') source = 'owner';
  else if (run.entry === 'form') source = 'customer';
  else if (c.source === 'system' || c.source === 'partner') source = c.source;
  else throw new Error(`${run.id}: the intake API takes system and partner requests, not ${c.source}`);
  return { ...rest, source, ...(run.entry !== 'form' && amount_inr !== undefined && { amount_inr }) };
}

/** The pack the organization runs: the ready-made one, or what signup composes from the owner's words. */
export function packFor(run: SectorRun, registry: Map<string, Pack>): ResolvedPack {
  const lookup = (id: string) => registry.get(id);
  const own = registry.get(run.orgType);
  return resolvePack(own ?? composeForSector(run.orgType, run.sector, [...registry.values()]).pack, lookup);
}

export interface RunExpectation {
  stageNames: string[];
  /** Absent for a request of our own: only finishing is checked. */
  category?: string;
  priority?: string;
  /** The role the approval (stage 5) and the sign-off (stage 7) go to; null when nobody is needed. */
  approval?: string | null;
  signoff?: string | null;
}

export function expectationFor(run: SectorRun, pack: ResolvedPack, suites: EvalSuite[]): RunExpectation {
  const stageNames = lifecycleOf(pack).stages.map((s) => s.name);
  if (!run.suiteCase) return { stageNames };
  const c = findCase(suites, run.suiteCase);
  const role = (gate?: { required: boolean; role?: string }) => (gate?.required ? (gate.role ?? 'owner') : null);
  return { stageNames, category: c.expect.category, priority: c.expect.priority, approval: role(c.expect.approval), signoff: role(c.expect.signoff) };
}

/** Every tool name the organization's agents could use: the catalog's and the pack's own names for them. */
export function toolNamesOf(pack: ResolvedPack): string[] {
  return [...new Set([...TOOL_CATALOG.map((t) => t.name), ...pack.tools.map((t) => t.name)])];
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** What's wrong with a sentence a person reads, or null. */
function leak(text: string, toolNames: string[]): string | null {
  const tool = toolNames.find((t) => new RegExp(`(?<![\\w.])${t.replace(/\./g, '\\.')}(?!\\w|\\.\\w)`).test(text));
  if (tool) return `names the tool ${tool}`;
  if (UUID.test(text)) return 'shows an id';
  if (/[{[]\s*"/.test(text)) return 'shows raw data';
  return null;
}

/** Every sentence people read about the case: the report, each stage's summary, and each approval's summary and reasons. */
function wordsPeopleRead(d: CaseDetail): string[] {
  return [d.report.text, ...d.report.stages.map((s) => s.summary ?? ''), ...d.approvals.flatMap((a) => [a.summary, ...a.reasons])].filter((t) => t.length > 0);
}

/**
 * What's wrong with a finished case. Strict runs (offline rules) must match the
 * test set exactly. Live runs (a real model) may judge differently; that is
 * reported as a difference, and only broken behaviour is a problem.
 */
export function caseProblems(d: CaseDetail, want: RunExpectation, toolNames: string[], mode: 'strict' | 'live'): { problems: string[]; differences: string[] } {
  const problems: string[] = [];
  const differences: string[] = [];
  const judged = (what: string) => (mode === 'strict' ? problems : differences).push(what);

  const finished = mode === 'strict' ? ['closed'] : ['closed', 'rejected'];
  if (!finished.includes(d.case.status)) problems.push(`ended ${d.case.status}${d.case.outcome ? `: ${d.case.outcome}` : ''}`);
  else if (d.case.status !== 'closed') differences.push(`ended ${d.case.status}: ${d.case.outcome ?? ''}`);

  const names = d.report.stages.map((s) => s.name);
  if (names.join(' | ') !== want.stageNames.join(' | ')) problems.push(`stage names ${names.join(', ')}`);
  for (const s of d.report.stages) if (s.status !== 'done' && s.status !== 'skipped') problems.push(`${s.name} is ${s.status}`);

  if (want.category !== undefined && d.case.category !== want.category) judged(`category ${d.case.category}, expected ${want.category}`);
  if (want.priority !== undefined && d.case.priority !== want.priority) judged(`priority ${d.case.priority}, expected ${want.priority}`);
  for (const [stage, role, what] of [
    ['approve', want.approval, 'approval'],
    ['close', want.signoff, 'sign-off'],
  ] as const) {
    if (role === undefined) continue;
    const gate = d.approvals.find((a) => a.kind === 'case_gate' && a.stage === stage);
    if ((gate?.approver ?? null) !== role) judged(`${what} went to ${gate?.approver ?? 'nobody'}, expected ${role ?? 'nobody'}`);
    else if (gate && gate.status !== 'approved') problems.push(`${what} is ${gate.status}`);
  }

  for (const text of wordsPeopleRead(d)) {
    const wrong = leak(text, toolNames);
    if (wrong) problems.push(`“${text}” ${wrong}`);
  }
  return { problems, differences };
}

export interface RunResult {
  run: SectorRun;
  /** The case code, once the case exists. */
  code?: string;
  seconds: number;
  problems: string[];
  differences: string[];
  /** Why the run stopped early: an error, or the stage it got stuck at. */
  error?: string;
}

/** One line per organization, its problems and the model's differences under it, then the count. */
export function formatSummary(results: RunResult[]): { text: string; ok: boolean } {
  const failed = (r: RunResult) => !!r.error || r.problems.length > 0;
  const width = Math.max(...results.map((r) => r.run.id.length));
  const lines = results.map((r) => {
    const head = `${failed(r) ? '✗' : '✓'} ${r.run.id.padEnd(width)}  ${(r.code ?? '-').padEnd(8)} ${String(Math.round(r.seconds)).padStart(4)}s`;
    const notes = [...(r.error ? [r.error] : []), ...r.problems, ...r.differences.map((d) => `model: ${d}`)];
    return [head, ...notes.map((n) => `    · ${n}`)].join('\n');
  });
  const bad = results.filter(failed).length;
  lines.push(`\n${results.length} organizations: ${results.length - bad} passed, ${bad} failed`);
  return { text: lines.join('\n'), ok: bad === 0 };
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `pnpm --filter @onehuman/evals exec vitest run src/sector-runs.test.ts`
Expected: PASS, every test. If one of the "gets the test set's answers offline" rows fails, the chosen case doesn't survive its door (for example a form request whose amount isn't in its words). Swap it for another case of the same type that needs both an approval and a sign-off (`node` the selection script below), ledger a ruling, and re-run.

```bash
# Lists, per test set, the cases the offline rules get fully right, approval+sign-off ("AS") first.
node -e "import('./evals/src/runner.ts').then(async ({loadPackRegistry,loadSuites,runSuite})=>{const {resolvePack}=await import('./packages/agent-kit/dist/index.js');const reg=loadPackRegistry('packs/');for(const s of loadSuites('evals/suites/')){const card=runSuite(resolvePack(reg.get(s.pack),(id)=>reg.get(id)),s,new Date('2026-01-01T09:00:00Z'));const bad=new Set(card.failures.map(f=>f.caseId));console.log(s.pack, s.cases.filter(c=>!bad.has(c.id)&&c.expect.approval?.required&&c.expect.signoff?.required).map(c=>c.id+'['+c.source+']').join(' '))}})"
```

- [ ] **Step 5: Run the whole evals package**

Run: `pnpm --filter @onehuman/evals test && pnpm --filter @onehuman/evals typecheck`
Expected: every suite passes; no type errors.

- [ ] **Step 6: Commit**

```bash
git add evals/src/sector-runs.ts evals/src/sector-runs.test.ts
git commit -m "test(evals): the 20 organizations the full end-to-end run sets up, each request's expected answers, and the checks on a finished case

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `pnpm e2e:sectors` — every organization type against the running stack

**Files:**
- Create: `master-ai-backend/scripts/lib.ts`
- Create: `master-ai-backend/scripts/sectors.mts`
- Create: `master-ai-backend/scripts/tsconfig.json`
- Modify: `master-ai-backend/scripts/smoke.ts` (helpers move to `lib.ts`)
- Modify: `master-ai-backend/package.json` (`e2e:sectors`, typecheck)
- Modify: `package.json` (root `e2e:sectors`)

**Interfaces:**
- Consumes: everything Task 1 produces (from `../../evals/src/sector-runs.ts`), and `loadPackRegistry`, `loadSuites` from `../../evals/src/runner.ts`.
- Produces: `pnpm e2e:sectors [--only <run id>]` (exit 0 when every organization passes). `scripts/lib.ts` exports `API_URL`, `PASSWORD`, `log`, `waitFor`, `onboard`, `signedDecision`, `SuiteCase`, `suiteCase`, `FINAL`, `driveCase`, `expectStatus`, `invite`, `type Person`.

This task's test is the run itself, against `pnpm dev` (which is running). The checks it applies are the ones Task 1 unit-tested.

- [ ] **Step 1: Add the commands, and watch the run fail**

In `master-ai-backend/package.json` `scripts`, add after `"smoke"`:

```json
    "e2e:sectors": "tsx scripts/sectors.mts"
```

and change `"typecheck"` to:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc -p scripts/tsconfig.json",
```

In the root `package.json` `scripts`, add after `"e2e:mobile"`:

```json
    "e2e:sectors": "pnpm --filter @onehuman/backend e2e:sectors"
```

Run: `pnpm e2e:sectors`
Expected: FAIL — tsx cannot find `scripts/sectors.mts`.

- [ ] **Step 2: Move the smoke helpers into `scripts/lib.ts`**

Create `master-ai-backend/scripts/lib.ts`. Move these from `smoke.ts` **verbatim**, adding `export`: `API_URL`, `log`, `waitFor`, `signedDecision`, `interface SuiteCase`, `suiteCase`, `FINAL`, `driveCase`, `expectStatus`. Move `onboard` with one change: `industry` becomes optional (`industry: string | undefined`), since signup defaults it to the type's name. Add `PASSWORD` and `invite` (the invite-and-join steps from `roleChecks`' local `join`, so both scripts share them):

```ts
/**
 * Helpers shared by the end-to-end scripts (smoke.ts, sectors.mts): they talk
 * to a running API exactly the way the apps do.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { CaseDetail, SectorId } from '@onehuman/schemas';
import { ApiError, createClient, createDeviceKey, signApproval, type ApiClient } from '@onehuman/sdk';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';

// … log, waitFor, onboard, signedDecision, SuiteCase, suiteCase, FINAL, driveCase, expectStatus, moved verbatim …

export type Person = Awaited<ReturnType<typeof invite>>;

/** Invite someone with an access role and approver roles; they accept, sign in and register a device key. */
export async function invite(
  owner: ApiClient,
  tenantId: string,
  who: { name: string; approverRoles?: string[]; role?: 'admin' | 'member'; email?: string; password?: string },
) {
  const email = who.email ?? `${who.name.toLowerCase().replace(/[^a-z]+/g, '')}+${randomBytes(3).toString('hex')}@example.com`;
  const inv = await owner.invites.create({ name: who.name, email, approverRoles: who.approverRoles ?? [], role: who.role ?? 'member' });
  const token = inv.path.split('/').pop()!;
  const view = await owner.invites.view(tenantId, token);
  const auth = await owner.invites.accept(tenantId, token, { password: who.password ?? PASSWORD });
  let session: string | null = auth.token;
  const api = createClient({ baseUrl: API_URL, getToken: () => session });
  const key = createDeviceKey(new Uint8Array(randomBytes(32)));
  const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: `e2e-${who.name}`, platform: 'web' });
  return { api, auth, key, device, inv, view, signOut: () => (session = null) };
}
```

`suiteCase` reads `join(__dirname, '../../evals/suites', …)`; it stays valid because `lib.ts` sits in the same folder as `smoke.ts`. `onboard` uses `PASSWORD` instead of the literal.

In `smoke.ts`: delete the moved code, import it, and make `roleChecks`' `join` a thin wrapper so the rest of `roleChecks` is unchanged:

```ts
import { API_URL, driveCase, expectStatus, FINAL, invite, log, onboard, signedDecision, suiteCase, waitFor } from './lib';
```

```ts
  const join = (name: string, approverRoles: string[], email?: string, password?: string, role: 'admin' | 'member' = 'member') =>
    invite(owner, tenantId, { name, approverRoles, email, password, role });
```

Remove imports `smoke.ts` no longer uses (`readFileSync`, `join` from `node:path`, `parse`, `signApproval`, `SectorId` if unused) — the typecheck in Step 5 lists any left.

- [ ] **Step 3: Check the smoke test still passes after the move**

Run: `pnpm smoke > .superpowers/sdd/2026-10-13-plan-7-final-pass/smoke.log 2>&1; tail -5 .superpowers/sdd/2026-10-13-plan-7-final-pass/smoke.log`
Expected: `Smoke test passed.`

- [ ] **Step 4: Write `scripts/sectors.mts` and `scripts/tsconfig.json`**

Create `master-ai-backend/scripts/sectors.mts`:

```ts
/**
 * Every organization type end to end, against a running API + worker: the 15
 * ready-made types and one per sector typed in the owner's own words. Each
 * signs up, checks its 8 stage names (and, for own words, the type it was
 * built on), invites the people its rules name plus a member, sends one real
 * request through the door it would really use (New request, the public form
 * or the intake API) and drives it to the report: someone without the role is
 * refused, the role holder approves, the sign-off goes to its role, and
 * nothing people read names a tool or shows an id. Offline, the five sectors
 * run in parallel.
 *
 * With a model configured (GET /health says llm: online) it runs one
 * organization per sector, one at a time (rate limits), answers a request for
 * more details once, and reports the model's judgement next to the test set's
 * instead of failing on it.
 *
 * Run: pnpm e2e:sectors [--only <run id>]   (API_URL defaults to localhost:3000)
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDeviceKey, type ApiClient } from '@onehuman/sdk';
import { loadPackRegistry, loadSuites } from '../../evals/src/runner.ts';
import {
  asSent,
  caseProblems,
  expectationFor,
  findCase,
  formatSummary,
  LIVE_RUN_IDS,
  packFor,
  SECTOR_RUNS,
  toolNamesOf,
  type RunResult,
  type SectorRun,
} from '../../evals/src/sector-runs.ts';
import { API_URL, expectStatus, FINAL, invite, log, onboard, signedDecision, type Person } from './lib.ts';

const health = (await fetch(`${API_URL}/health`).then((r) => r.json())) as { llm: 'online' | 'offline'; provider?: string };
const LIVE = health.llm === 'online';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const registry = loadPackRegistry(fileURLToPath(new URL('../../packs/', import.meta.url)));
const suites = loadSuites(fileURLToPath(new URL('../../evals/suites/', import.meta.url)));
const runs = SECTOR_RUNS.filter((r) => (only ? r.id === only : !LIVE || LIVE_RUN_IDS.includes(r.id)));
if (runs.length === 0) throw new Error(`No run called ${only}. The runs are: ${SECTOR_RUNS.map((r) => r.id).join(', ')}`);
const TIMEOUT_MS = LIVE ? 600_000 : 300_000;
const roleName = (role: string) => role.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send the request through the run's door; returns the case id. */
async function send(run: SectorRun, owner: ApiClient, tenantId: string, text: string, amountInr: number | undefined, source: string): Promise<string> {
  if (run.entry === 'app') return (await owner.cases.create({ text, ...(amountInr !== undefined && { amountInr }) })).id;
  if (run.entry === 'form') {
    const form = await owner.intakeKeys.create({ kind: 'form', label: 'Website' });
    const sent = await owner.intake.submitForm(tenantId, form.key, { name: 'Lakshmi Iyer', phone: '9876543210', text });
    const found = (await owner.cases.list('all')).find((x) => x.code === sent.code);
    if (!found) throw new Error(`the form's case ${sent.code} is not in the case list`);
    return found.id;
  }
  const key = await owner.intakeKeys.create({ kind: 'api', label: 'Their system', source: source as 'system' | 'partner' });
  const sent = await owner.intake.submit(tenantId, key.key, {
    text,
    requester: { name: 'Their system' },
    externalRef: `e2e-${run.id}`,
    ...(amountInr !== undefined && { amountInr }),
  });
  return sent.caseId;
}

async function runOne(run: SectorRun): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { run, seconds: 0, problems: [], differences: [] };
  try {
    const pack = packFor(run, registry);
    const want = expectationFor(run, pack, suites);
    const ownWords = !registry.has(run.orgType);
    const org = await onboard(run.sector, run.orgType, ownWords ? run.orgType : undefined, `E2E ${run.id} ${randomBytes(2).toString('hex')}`);
    const owner = org.api;
    const tenantId = org.auth.tenant.id;
    const installed = org.ws.pack.lifecycle?.stages.map((s) => s.name) ?? [];
    if (installed.join(' | ') !== want.stageNames.join(' | ')) throw new Error(`installed with the stages ${installed.join(', ')}`);
    if (!org.ws.pack.lineage.includes(run.basedOn)) throw new Error(`built on ${org.ws.pack.lineage.join(' → ')}, expected ${run.basedOn}`);
    log(`${run.id}: installed`, `${org.ws.pack.lineage.join(' → ')} · ${installed.join(' → ')}`);

    await owner.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
    const ownerKey = createDeviceKey(new Uint8Array(randomBytes(32)));
    const ownerDevice = await owner.auth.registerDeviceKey({ publicKey: ownerKey.publicKey, label: 'e2e-owner', platform: 'web' });
    const holders = new Map<string, Person>();
    for (const role of new Set([want.approval, want.signoff])) {
      if (role && role !== 'owner') holders.set(role, await invite(owner, tenantId, { name: roleName(role), approverRoles: [role] }));
    }
    const member = await invite(owner, tenantId, { name: 'Manoj Member' });

    const c = run.suiteCase ? asSent(run, findCase(suites, run.suiteCase)) : undefined;
    const caseId = await send(run, owner, tenantId, c?.request ?? run.request!, c?.amount_inr, c?.source ?? 'owner');

    let memberRefused = false;
    let answeredOnce = false;
    const until = Date.now() + TIMEOUT_MS;
    let d = await owner.cases.get(caseId);
    while (!(FINAL.includes(d.case.status) && d.report.stages[7]?.status === 'done')) {
      result.code = d.case.code;
      if (Date.now() > until) throw new Error(`${d.case.code} stayed at ${d.report.stages.find((s) => s.stage === d.case.stage)?.name ?? d.case.stage} (${d.case.status})`);
      if (LIVE && d.case.status === 'needs_info' && !answeredOnce) {
        answeredOnce = true;
        result.differences.push(`asked for more details: ${(d.file.review?.missing ?? []).map((m) => m.label).join(', ')}`);
        await owner.cases.addInfo(caseId, { text: 'That is everything we know. Please go ahead with what is in the request.' });
      }
      const pending = (await owner.approvals.list('pending')).filter((a) => a.caseId === caseId || (d.case.goalId && a.goalId === d.case.goalId));
      for (const a of pending) {
        if (a.kind === 'case_gate' && !memberRefused) {
          await expectStatus(signedDecision(member.api, member.key.seed, member.device.id, a.id, 'approved'), 403, `${run.id}: someone without the role is refused`);
          memberRefused = true;
        }
        const holder = a.approver === 'owner' ? undefined : holders.get(a.approver);
        const by = holder ?? { api: owner, key: ownerKey, device: ownerDevice };
        await signedDecision(by.api, by.key.seed, by.device.id, a.id, 'approved', 'Checked in the end-to-end run');
        if (a.kind === 'case_gate') log(`${run.id}: ${a.stage === 'close' ? 'signed off' : 'approved'} by ${holder ? roleName(a.approver) : 'the owner'}`, a.summary);
      }
      await sleep(1500);
      d = await owner.cases.get(caseId);
    }
    result.code = d.case.code;
    const checked = caseProblems(d, want, toolNamesOf(pack), LIVE ? 'live' : 'strict');
    result.problems.push(...checked.problems);
    result.differences.push(...checked.differences);
    if ((want.approval || want.signoff) && !memberRefused) result.problems.push('no approval was offered to someone without the role');
    log(`${run.id}: ${d.case.code} ${d.case.status}`, d.report.text);
  } catch (err) {
    result.error = (err as Error).message;
  }
  result.seconds = (Date.now() - started) / 1000;
  return result;
}

// Offline, one lane per sector. A real model has rate limits (a free key especially), so live runs go one at a time.
const lanes = new Map<string, SectorRun[]>();
for (const run of runs) {
  const lane = LIVE ? 'one at a time' : run.sector;
  lanes.set(lane, [...(lanes.get(lane) ?? []), run]);
}
console.log(
  `${runs.length} organizations in ${lanes.size} lane(s), LLM ${health.llm}${health.provider ? ` (${health.provider})` : ''}${LIVE ? ': a real model answers, so its judgement is reported, not enforced' : ''}\n`,
);
const results: RunResult[] = [];
await Promise.all(
  [...lanes.values()].map(async (lane) => {
    for (const run of lane) results.push(await runOne(run));
  }),
);
results.sort((a, b) => runs.indexOf(a.run) - runs.indexOf(b.run));
const summary = formatSummary(results);
console.log(`\n${summary.text}`);
process.exit(summary.ok ? 0 : 1);
```

Create `master-ai-backend/scripts/tsconfig.json` (standalone, so the build's incremental settings don't apply):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["."]
}
```

- [ ] **Step 5: Typecheck the scripts**

Run: `pnpm --filter @onehuman/backend typecheck`
Expected: no errors. (If `smoke.ts` reports an unused import left from Step 2, remove it.)

- [ ] **Step 6: Run one organization, then all of them**

Run: `pnpm e2e:sectors --only power-plant`
Expected: `✓ power-plant …` and `1 organizations: 1 passed, 0 failed`, with log lines for "someone without the role is refused", "approved by Plant Head" and "signed off by Safety Officer".

Run: `pnpm e2e:sectors > .superpowers/sdd/2026-10-13-plan-7-final-pass/sectors.log 2>&1; tail -45 .superpowers/sdd/2026-10-13-plan-7-final-pass/sectors.log`
Expected: `20 organizations: 20 passed, 0 failed`, in under 10 minutes.

**If an organization fails, that's a finding about the product, not the script.** Use superpowers:systematic-debugging: read the problem line, the API and worker output, and the case's stage summaries. Write the failing unit test in the package that owns the bug (agent-kit for stage rules and words, policy for reasons, backend for routing), make it pass, rebuild packages, and re-run `pnpm e2e:sectors --only <id>`. Ledger each as `Task 2: Ruling: <what the run found> — fixed in <file> with <test name>`. A leaked tool name in an approval reason is a real finding too (it's on Plan 6's deferred list as "gate reasons can name a tool").

- [ ] **Step 7: Commit**

```bash
git add master-ai-backend/scripts master-ai-backend/package.json package.json
git commit -m "test(e2e): pnpm e2e:sectors runs every organization type end to end — role holders approve, members are refused, nothing people read names a tool

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `pnpm evals:live` survives model errors and stops on a refused key

**Files:**
- Modify: `evals/src/live-lib.ts` (`LiveScorecard`, `runLiveSuite`'s `ask`, `formatLiveScorecard`)
- Modify: `evals/src/live.ts` (the `complete` function, the main loop)
- Test: `evals/src/live.test.ts`

**Interfaces:**
- Produces: `class LiveFatalError extends Error` (exported from `live-lib.ts`); `LiveScorecard.errors: number` (calls that failed, where the rules answered).

- [ ] **Step 1: Write the failing tests**

Add to `evals/src/live.test.ts` (import `LiveFatalError` from `./live-lib.ts` alongside `runLiveSuite`):

```ts
  it('counts a failed call as the rules answering, and keeps going', async () => {
    let calls = 0;
    const flaky: LiveComplete = async () => {
      calls++;
      throw new Error('529 overloaded');
    };
    const card = await runLiveSuite(pack, suite, flaky);
    const offline = runSuite(pack, suite);
    expect(calls).toBe(suite.cases.length * 2);
    expect(card.errors).toBe(suite.cases.length * 2);
    expect(card.fallbacks).toBe(suite.cases.length * 2);
    expect(card.stages.category).toEqual(offline.stages.category);
  });

  it('stops at the first call when the key is refused', async () => {
    let calls = 0;
    const refused: LiveComplete = async () => {
      calls++;
      throw new LiveFatalError('The model refused the key (401 invalid x-api-key).');
    };
    await expect(runLiveSuite(pack, suite, refused)).rejects.toThrow('refused the key');
    expect(calls).toBe(1);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @onehuman/evals exec vitest run src/live.test.ts`
Expected: FAIL — `LiveFatalError` is not exported (the import fails, so every test in the file errors).

- [ ] **Step 3: Write the implementation**

In `evals/src/live-lib.ts`, add after the `LiveComplete` type:

```ts
/** A model error no retry fixes (a refused key, an unknown model): the run stops at once. */
export class LiveFatalError extends Error {}
```

Add to `LiveScorecard`:

```ts
  /** Calls that failed (overloaded, timed out), where the rules answered instead. */
  errors: number;
```

Initialise `errors: 0` in `runLiveSuite`'s `card`, and replace the first line of `ask` with a guarded call:

```ts
  const ask = async <S extends ModelStage>(stage: S, user: string): Promise<ModelStageOutput<S> | null> => {
    let answer: Awaited<ReturnType<LiveComplete>>;
    try {
      answer = await complete({ stage, tier: MODEL_STAGE_TIERS[stage], system: system(stage), user, schema: modelStageJsonSchema(stage) });
    } catch (err) {
      if (err instanceof LiveFatalError) throw err;
      card.errors++;
      card.fallbacks++;
      return null;
    }
    card.costUsd += answer.costUsd;
```

(the rest of `ask` is unchanged). In `formatLiveScorecard`, append the failed calls when there are any:

```ts
export function formatLiveScorecard(card: LiveScorecard): string {
  const failed = card.errors > 0 ? ` (${card.errors} calls failed)` : '';
  return `${formatScorecard(card)}\n  model answers ${card.modelAnswers}, fell back to rules ${card.fallbacks}${failed}, cost $${card.costUsd.toFixed(4)}`;
}
```

In `evals/src/live.ts`, import `LiveFatalError` with the other `live-lib.ts` names, turn key and model errors into fatal ones, and print one line instead of a stack trace. Add the helper above `complete`, and chain it onto the existing `create` call (a `.catch` keeps the SDK's inferred message type, so nothing else in `complete` changes):

```ts
/** Key and model errors stop the run; anything else is one failed call. */
function fatal(err: unknown, model: string): unknown {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LiveFatalError(`The model refused the key (${err.status} ${err.message}). Check ANTHROPIC_API_KEY.`);
  }
  if (err instanceof Anthropic.NotFoundError) return new LiveFatalError(`No model called ${model} (${err.message}). Check LLM_MODEL_* in your environment.`);
  return err;
}

const complete: LiveComplete = async (req) => {
  const model = models[req.tier];
  const message = await client.beta.messages
    .create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
    })
    .catch((err: unknown) => {
      throw fatal(err, model);
    });
  // … the rest (text, json, usage, return) unchanged …
};
```

and wrap the suite loop:

```ts
try {
  for (const suite of loadSuites(fileURLToPath(new URL('../suites/', import.meta.url)))) {
    // … unchanged loop body …
  }
} catch (err) {
  if (!(err instanceof LiveFatalError)) throw err;
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 4: Run the tests, the package and the no-key path**

Run: `pnpm --filter @onehuman/evals test && pnpm --filter @onehuman/evals typecheck`
Expected: PASS, including the two new tests; no type errors.

Run: `pnpm evals:live`
Expected (no key here): `pnpm evals:live needs ANTHROPIC_API_KEY. Without a key, \`pnpm evals\` scores the rules alone.`, exit 0.

Run: `ANTHROPIC_API_KEY=sk-ant-not-a-real-key pnpm evals:live --pack power-plant; echo "exit=$?"`
Expected: one line starting `The model refused the key (401`, then `exit=1`. (This sends one request with a fake key to the Anthropic API, which refuses it; nothing is billed.)

- [ ] **Step 5: Commit**

```bash
git add evals/src/live-lib.ts evals/src/live.ts evals/src/live.test.ts
git commit -m "fix(evals): evals:live counts failed model calls as rule answers and stops at once on a refused key

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Google Gemini as a second model provider

**Files:**
- Create: `packages/agent-kit/src/gemini.ts`, `packages/agent-kit/src/gemini.test.ts`
- Modify: `packages/agent-kit/src/pricing.ts` (Gemini prices), `packages/agent-kit/src/index.ts` (export)
- Modify: `master-ai-backend/src/config.ts`, `master-ai-backend/src/llm/llm.service.ts`, `master-ai-backend/src/health.controller.ts`, `master-ai-backend/src/main.ts`, `master-ai-backend/src/worker.ts`, `master-ai-backend/.env.example`
- Create: `master-ai-backend/src/llm/provider.test.ts`
- Modify: `evals/src/live-lib.ts` (`paced`), `evals/src/live.ts`, `evals/src/live.test.ts`, root `package.json` (`evals:live` reads the backend's `.env`)
- Modify: `master-ai-backend/package.json`, `evals/package.json`, `pnpm-lock.yaml` (`@google/genai` 2.24.0)

**Interfaces:**
- Consumes: `LiveFatalError`, `LiveComplete` (Task 3); `LlmToolDefinition`, `costUsd`, `Usage` from agent-kit.
- Produces:
  - agent-kit: `GEMINI_DEFAULT_MODELS: Record<ModelTier, string>`; `interface GeminiRequest { system: string; user: string; tools?: LlmToolDefinition[]; jsonSchema?: Record<string, unknown>; maxTokens: number }`; `geminiParams(model: string, req: GeminiRequest)`; `interface GeminiResponseLike`; `mergeGeminiChunks(chunks: GeminiResponseLike[]): GeminiResponseLike`; `readGemini(res: GeminiResponseLike, asked: { model: string; jsonSchema?: boolean }): GeminiReading`; `costUsd` prices Gemini models by family.
  - backend: `llmProviderFor(env): 'anthropic' | 'google' | 'offline'` and `config.llmProvider`; `LlmService.provider`; `LlmResult.provider` gains `'google'`; `GET /health` returns `{ ok, llm, provider, packs }`.
  - evals: `paced(complete: LiveComplete, rpm: number, sleep?, now?): LiveComplete`; `pnpm evals:live [--pack <id>] [--rpm <n>]` uses Claude when its key is set, else Gemini.

How Gemini is mapped, so it behaves like the Claude path (`callAnthropic` in `llm.service.ts`):
- One turn: the stable instructions go in `systemInstruction`, the user text in `contents`, the token limit in `maxOutputTokens`.
- JSON answers: `responseMimeType: 'application/json'` plus `responseJsonSchema` (the same JSON Schema Claude gets).
- Tools: one `functionDeclarations` list with `parametersJsonSchema`. Tool names already arrive as wire names (`records__update`, see `toWireName` in `agent-kit/src/tools.ts`), which Gemini accepts. Claude is told `disable_parallel_tool_use`; Gemini has no such switch, so only the first call is taken (the agent runtime runs one step per turn).
- The model's thinking (`thought: true` parts) never becomes text people see.
- Refusals: a `promptFeedback.blockReason`, or a finish reason of `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII` or `RECITATION`, becomes `LlmRefusalError`.
- `MAX_TOKENS` or `MALFORMED_FUNCTION_CALL` drops the tool calls: a cut-off or malformed call never runs.
- Usage is counted as billed: input = prompt − cached, cache reads = cached, output = answer + thinking.
- Retries: the SDK retries 408, 429 and 5xx up to 5 times by itself; after that, a 429 or 5xx (or a network failure) moves to the request's fallback tier, as with Claude.
- Prompt caching is implicit on Gemini; the server-side refusal fallback is Claude-only.

- [ ] **Step 1: Install the SDK, and check everything it brought is at least 14 days old**

Run: `pnpm --filter @onehuman/backend --filter @onehuman/evals add -E @google/genai@2.24.0`
Expected: both `package.json` files gain `"@google/genai": "2.24.0"`.

Check the lockfile moved nothing else, then check the age of every package added:

```bash
W=.superpowers/sdd/2026-10-13-plan-7-final-pass
git diff -U0 pnpm-lock.yaml | grep -c '^-[^-]'
git diff -U0 pnpm-lock.yaml | grep -E "^\+  '?[@a-z0-9][^ ]*@[0-9][^ ]*'?:$" | sed -E "s/^\+  '?//; s/'?:$//; s/\(.*//" | sort -u > $W/new-packages.txt
node -e '
const { execSync } = require("node:child_process");
const cutoff = Date.now() - 14 * 864e5;
for (const spec of require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at), version = spec.slice(at + 1);
  const published = JSON.parse(execSync(`npm view ${name} time --json`).toString())[version];
  console.log(new Date(published).getTime() <= cutoff ? "ok " : "NEW", spec, published);
}' $W/new-packages.txt
```

Expected: `0` removed lines (only the `importers` blocks change, by adding), and every package line starts with `ok`. If other packages moved (as Playwright's install once moved Expo onto TypeScript 6), restore with `git checkout pnpm-lock.yaml master-ai-backend/package.json evals/package.json`, run `pnpm install --offline`, and add again with `--prefer-offline`. If a line says `NEW`, pin that package in `pnpm-workspace.yaml` `overrides` to its newest version published at least 14 days ago (`npm view <name> time --json`), run `pnpm install`, re-check, and ledger the override.

- [ ] **Step 2: Write the failing agent-kit tests**

Create `packages/agent-kit/src/gemini.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { costUsd, GEMINI_DEFAULT_MODELS, geminiParams, mergeGeminiChunks, readGemini, type GeminiResponseLike } from './index';

const TOOL = { name: 'records__update', description: 'Update a record', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } };
const USAGE = { promptTokenCount: 1200, cachedContentTokenCount: 200, candidatesTokenCount: 80, thoughtsTokenCount: 40 };
const answer = (parts: object[], finishReason = 'STOP', extra: object = {}): GeminiResponseLike => ({
  candidates: [{ content: { parts }, finishReason }],
  usageMetadata: USAGE,
  modelVersion: 'gemini-2.5-flash',
  ...extra,
});

describe('geminiParams', () => {
  it('sends the instructions, the one user turn and the token limit', () => {
    expect(geminiParams('gemini-flash-latest', { system: 'You review requests.', user: 'Pump B tripped.', maxTokens: 4000 })).toEqual({
      model: 'gemini-flash-latest',
      contents: 'Pump B tripped.',
      config: { systemInstruction: 'You review requests.', maxOutputTokens: 4000 },
    });
  });

  it('asks for JSON matching the schema', () => {
    const p = geminiParams('m', { system: 's', user: 'u', maxTokens: 10, jsonSchema: { type: 'object' } });
    expect(p.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } });
  });

  it('offers tools as function declarations with their JSON schemas', () => {
    const p = geminiParams('m', { system: 's', user: 'u', maxTokens: 10, tools: [TOOL] });
    expect(p.config.tools).toEqual([{ functionDeclarations: [{ name: 'records__update', description: 'Update a record', parametersJsonSchema: TOOL.input_schema }] }]);
  });

  it('has a model for every tier', () => {
    expect(Object.keys(GEMINI_DEFAULT_MODELS).sort()).toEqual(['frontier', 'small', 'standard']);
  });
});

describe('readGemini', () => {
  it("reads the text without the model's thinking, and counts tokens the way they are billed", () => {
    const r = readGemini(answer([{ text: 'Weighing it up…', thought: true }, { text: 'Done.' }]), { model: 'gemini-flash-latest' });
    expect(r).toMatchObject({ text: 'Done.', toolCalls: [], json: null, stopReason: 'end_turn', model: 'gemini-2.5-flash', refused: null });
    expect(r.usage).toEqual({ inputTokens: 1000, cacheReadTokens: 200, outputTokens: 120, cacheWriteTokens: 0 });
  });

  it('parses JSON when a schema was asked for, and gives null for broken JSON', () => {
    expect(readGemini(answer([{ text: '{"category":"breakdown"}' }]), { model: 'm', jsonSchema: true }).json).toEqual({ category: 'breakdown' });
    expect(readGemini(answer([{ text: '{"category":' }]), { model: 'm', jsonSchema: true }).json).toBeNull();
    expect(readGemini(answer([{ text: '{"category":"breakdown"}' }]), { model: 'm' }).json).toBeNull();
  });

  it('takes only the first tool call, one step at a time like the Claude path', () => {
    const r = readGemini(answer([{ text: 'Marking it done.' }, { functionCall: { name: 'records__update', args: { id: 'a' } } }, { functionCall: { name: 'task__finish', args: {} } }]), { model: 'm' });
    expect(r.toolCalls).toEqual([{ name: 'records__update', input: { id: 'a' } }]);
    expect(r.stopReason).toBe('tool_use');
  });

  it('never runs a tool call cut off at the token limit, or a malformed one', () => {
    const call = { functionCall: { name: 'records__update', args: { id: 'a' } } };
    expect(readGemini(answer([call], 'MAX_TOKENS'), { model: 'm' })).toMatchObject({ toolCalls: [], stopReason: 'max_tokens' });
    expect(readGemini(answer([call], 'MALFORMED_FUNCTION_CALL'), { model: 'm' })).toMatchObject({ toolCalls: [], stopReason: 'malformed_tool_call' });
  });

  it('treats a blocked prompt or a blocked answer as a refusal', () => {
    expect(readGemini({ promptFeedback: { blockReason: 'SAFETY' } }, { model: 'm' })).toMatchObject({ refused: 'safety', stopReason: 'refusal', toolCalls: [] });
    expect(readGemini(answer([{ text: 'partial' }], 'PROHIBITED_CONTENT'), { model: 'm' }).refused).toBe('prohibited_content');
  });

  it('names the model asked for when the response does not say which one answered', () => {
    expect(readGemini({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }, { model: 'gemini-flash-latest' }).model).toBe('gemini-flash-latest');
  });
});

describe('mergeGeminiChunks', () => {
  it('joins streamed parts in order and keeps the last finish reason, usage and model', () => {
    const merged = mergeGeminiChunks([
      { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'lo.' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: USAGE, modelVersion: 'gemini-2.5-flash' },
    ]);
    expect(readGemini(merged, { model: 'm' })).toMatchObject({ text: 'Hello.', stopReason: 'end_turn', model: 'gemini-2.5-flash' });
    expect(readGemini(merged, { model: 'm' }).usage.outputTokens).toBe(120);
  });
});

describe('Gemini prices', () => {
  const million = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  it('prices Gemini by family, Flash-Lite before Flash', () => {
    expect(costUsd('gemini-flash-lite-latest', million)).toBeCloseTo(0.1);
    expect(costUsd('gemini-flash-latest', million)).toBeCloseTo(0.3);
    expect(costUsd('gemini-3-pro-preview', million)).toBeCloseTo(2);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/gemini.test.ts`
Expected: FAIL — `geminiParams` (and the rest) are not exported.

- [ ] **Step 4: Write the mapping and the prices**

Create `packages/agent-kit/src/gemini.ts`:

```ts
/**
 * Google Gemini as a second model provider: the request and response mapping,
 * shared by the backend's LLM gateway and `pnpm evals:live` (like the prices).
 * Plain objects, so agent-kit needs no Google SDK; callers hand these to
 * `@google/genai`. Claude stays the default (ADR 0011).
 */
import type { ModelTier } from '@onehuman/schemas';
import type { Usage } from './pricing';
import type { LlmToolDefinition } from './tools';

/** Default model per tier. The -latest aliases follow Google's current Pro, Flash and Flash-Lite. */
export const GEMINI_DEFAULT_MODELS: Record<ModelTier, string> = {
  frontier: 'gemini-pro-latest',
  standard: 'gemini-flash-latest',
  small: 'gemini-flash-lite-latest',
};

export interface GeminiRequest {
  system: string;
  user: string;
  tools?: LlmToolDefinition[];
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
}

/** What `models.generateContent` and `models.generateContentStream` take: one turn, like every gateway call. */
export function geminiParams(model: string, req: GeminiRequest) {
  return {
    model,
    contents: req.user,
    config: {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens,
      ...(req.jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema }),
      ...(req.tools?.length && {
        tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
      }),
    },
  };
}

/** The parts of a Gemini response the gateway reads. The SDK's `GenerateContentResponse` fits this shape. */
export interface GeminiResponseLike {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

/** Streamed chunks as one response: every part in order, and the last finish reason, usage and model seen. */
export function mergeGeminiChunks(chunks: GeminiResponseLike[]): GeminiResponseLike {
  const lastWith = <T>(pick: (c: GeminiResponseLike) => T | undefined): T | undefined => {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const v = pick(chunks[i]!);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const finishReason = lastWith((c) => c.candidates?.[0]?.finishReason);
  return {
    candidates: [{ content: { parts: chunks.flatMap((c) => c.candidates?.[0]?.content?.parts ?? []) }, ...(finishReason && { finishReason }) }],
    promptFeedback: chunks.find((c) => c.promptFeedback?.blockReason)?.promptFeedback,
    usageMetadata: lastWith((c) => c.usageMetadata),
    modelVersion: lastWith((c) => c.modelVersion),
  };
}

export interface GeminiReading {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  json: unknown;
  /** In the gateway's words: end_turn, tool_use, max_tokens, malformed_tool_call or refusal. */
  stopReason: string;
  usage: Usage;
  /** The model that answered, or the one asked for. */
  model: string;
  /** Why Gemini blocked the prompt or the answer (lower case), or null. */
  refused: string | null;
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

export function readGemini(res: GeminiResponseLike, asked: { model: string; jsonSchema?: boolean }): GeminiReading {
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const finish = candidate?.finishReason;
  const blocked = res.promptFeedback?.blockReason ?? (finish && BLOCKED.has(finish) ? finish : undefined);
  const cut = finish === 'MAX_TOKENS';
  const malformed = finish === 'MALFORMED_FUNCTION_CALL';

  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');
  const calls = parts.flatMap((p) => (p.functionCall?.name ? [{ name: p.functionCall.name, input: p.functionCall.args ?? {} }] : []));
  const toolCalls = blocked || cut || malformed ? [] : calls.slice(0, 1);

  let json: unknown = null;
  if (asked.jsonSchema && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const usage: Usage = {
    inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
  const stopReason = blocked ? 'refusal' : cut ? 'max_tokens' : malformed ? 'malformed_tool_call' : toolCalls.length ? 'tool_use' : 'end_turn';
  return { text, toolCalls, json, stopReason, usage, model: res.modelVersion ?? asked.model, refused: blocked ? blocked.toLowerCase() : null };
}
```

In `packages/agent-kit/src/index.ts`, add `export * from './gemini';` after `export * from './pricing';`.

In `packages/agent-kit/src/pricing.ts`, add Gemini prices by family and use them before the fallback:

```ts
/** Approximate Gemini list prices by family (USD per million tokens). A free Gemini key costs nothing. */
const GEMINI_PRICES: [RegExp, Price][] = [
  [/^gemini-.*flash-lite/, { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }],
  [/^gemini-.*flash/, { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 }],
  [/^gemini-.*pro/, { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 0 }],
];
```

and in `costUsd`, replace the first line with:

```ts
  const p = PRICES[model] ?? GEMINI_PRICES.find(([family]) => family.test(model))?.[1] ?? FALLBACK_PRICE;
```

- [ ] **Step 5: Run the agent-kit tests, then rebuild the shared packages**

Run: `pnpm --filter @onehuman/agent-kit test && pnpm --filter @onehuman/agent-kit typecheck && pnpm build:packages`
Expected: PASS, including every `gemini.test.ts` test; no type errors; packages built.

- [ ] **Step 6: Write the failing backend test for choosing the provider**

Create `master-ai-backend/src/llm/provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { llmProviderFor } from '../config';

const base = { LLM_OFFLINE: 'auto', LLM_PROVIDER: 'auto' } as const;

describe('which model provider the gateway uses', () => {
  it('uses the offline rules when no key is set', () => {
    expect(llmProviderFor(base)).toBe('offline');
  });

  it('uses Claude when its key is set, even when a Gemini key is set too', () => {
    expect(llmProviderFor({ ...base, ANTHROPIC_API_KEY: 'sk-ant' })).toBe('anthropic');
    expect(llmProviderFor({ ...base, ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('anthropic');
  });

  it('uses Gemini when only its key is set, or when LLM_PROVIDER says so', () => {
    expect(llmProviderFor({ ...base, GEMINI_API_KEY: 'g' })).toBe('google');
    expect(llmProviderFor({ ...base, LLM_PROVIDER: 'google', ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('google');
  });

  it('refuses to start when Gemini is asked for without its key', () => {
    expect(() => llmProviderFor({ ...base, LLM_PROVIDER: 'google' })).toThrow('LLM_PROVIDER=google needs GEMINI_API_KEY');
  });

  it('stays offline when LLM_OFFLINE=always, whatever keys are set', () => {
    expect(llmProviderFor({ ...base, LLM_OFFLINE: 'always', ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('offline');
  });

  it('keeps LLM_OFFLINE=never meaning Claude, as before', () => {
    expect(llmProviderFor({ ...base, LLM_OFFLINE: 'never' })).toBe('anthropic');
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/backend exec vitest run src/llm/provider.test.ts`
Expected: FAIL — `llmProviderFor` is not exported from `../config`.

- [ ] **Step 8: Choose the provider in config, and call Gemini in the gateway**

In `master-ai-backend/src/config.ts`, import `GEMINI_DEFAULT_MODELS` from `@onehuman/agent-kit`, add to the env schema after `LLM_MODEL_SMALL`:

```ts
  /** Google Gemini, an optional second provider (ADR 0011): used when no Anthropic key is set, or when LLM_PROVIDER=google. */
  GEMINI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['auto', 'anthropic', 'google']).default('auto'),
  GEMINI_MODEL_FRONTIER: z.string().default(GEMINI_DEFAULT_MODELS.frontier),
  GEMINI_MODEL_STANDARD: z.string().default(GEMINI_DEFAULT_MODELS.standard),
  GEMINI_MODEL_SMALL: z.string().default(GEMINI_DEFAULT_MODELS.small),
```

add the exported helper above the `config` object:

```ts
/** Which model provider the gateway uses: Claude when its key is set, else Gemini when its key is set, else the offline rules. */
export function llmProviderFor(env: {
  LLM_OFFLINE: 'auto' | 'always' | 'never';
  LLM_PROVIDER: 'auto' | 'anthropic' | 'google';
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  GEMINI_API_KEY?: string;
}): 'anthropic' | 'google' | 'offline' {
  if (env.LLM_OFFLINE === 'always') return 'offline';
  const claude = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const gemini = !!env.GEMINI_API_KEY;
  if (env.LLM_PROVIDER === 'google') {
    if (!gemini) throw new Error('LLM_PROVIDER=google needs GEMINI_API_KEY');
    return 'google';
  }
  if (claude || env.LLM_OFFLINE === 'never') return 'anthropic';
  if (env.LLM_PROVIDER === 'auto' && gemini) return 'google';
  return 'offline';
}
```

and replace `llmOffline` and `models` in the `config` object with:

```ts
  llmProvider,
  llmOffline: llmProvider === 'offline',
  models:
    llmProvider === 'google'
      ? { frontier: env.GEMINI_MODEL_FRONTIER, standard: env.GEMINI_MODEL_STANDARD, small: env.GEMINI_MODEL_SMALL }
      : { frontier: env.LLM_MODEL_FRONTIER, standard: env.LLM_MODEL_STANDARD, small: env.LLM_MODEL_SMALL },
```

with `const llmProvider = llmProviderFor(env);` just above `export const config = {`.

In `master-ai-backend/src/llm/llm.service.ts`:
- Import `ApiError, GoogleGenAI` from `@google/genai` and `geminiParams, mergeGeminiChunks, readGemini, type GeminiResponseLike` from `@onehuman/agent-kit`.
- `LlmResult.provider` becomes `'anthropic' | 'google' | 'offline'`.
- Replace the client field and `mode` with:

```ts
  private readonly anthropic = config.llmProvider === 'anthropic' ? new Anthropic() : null;
  private readonly google = config.llmProvider === 'google' ? new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }) : null;

  get mode(): 'online' | 'offline' {
    return config.llmOffline ? 'offline' : 'online';
  }

  /** Which provider answers: anthropic (the default), google, or offline. */
  get provider(): 'anthropic' | 'google' | 'offline' {
    return config.llmProvider;
  }
```

- In `complete`, use `if (config.llmOffline)` for the offline branch, and call `this.call(req, …, user)` in place of both `this.callAnthropic(this.client, req, …, user)` calls.
- Add:

```ts
  private call(req: LlmRequest, model: string, user: string): Promise<LlmResult> {
    return this.google ? this.callGoogle(this.google, req, model, user) : this.callAnthropic(this.anthropic!, req, model, user);
  }

  /** Gemini, mapped so it behaves like the Claude path: one step at a time, thinking hidden, blocks as refusals. */
  private async callGoogle(ai: GoogleGenAI, req: LlmRequest, model: string, user: string): Promise<LlmResult> {
    const chunks: GeminiResponseLike[] = [];
    const stream = await ai.models.generateContentStream(
      geminiParams(model, { system: req.system, user, tools: req.tools, jsonSchema: req.jsonSchema, maxTokens: req.maxTokens ?? 16000 }),
    );
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (req.onText) for (const part of chunk.candidates?.[0]?.content?.parts ?? []) if (part.text && !part.thought) req.onText(part.text);
    }
    const read = readGemini(mergeGeminiChunks(chunks), { model, jsonSchema: !!req.jsonSchema });
    if (read.refused) throw new LlmRefusalError(read.refused);
    return {
      text: read.text,
      toolCalls: read.toolCalls,
      json: read.json,
      provider: 'google',
      model: read.model,
      stopReason: read.stopReason,
      usage: read.usage,
      costInr: costUsd(read.model, read.usage) * config.USD_INR_RATE,
      tokens: read.usage.inputTokens + read.usage.outputTokens + read.usage.cacheReadTokens,
    };
  }
```

- In `isRetryable`, add before the final `return false;`:

```ts
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  if (err instanceof TypeError) return true; // fetch failed: the network, not the request
```

In `master-ai-backend/src/health.controller.ts`, return `{ ok: true, llm: this.llm.mode, provider: this.llm.provider, packs: this.packs.list().length }`. In `main.ts` and `worker.ts`, change the LLM part of the start-up line to `` (LLM ${config.llmOffline ? 'offline mode' : config.llmProvider}) ``.

In `master-ai-backend/.env.example`, after the `LLM_MODEL_SMALL` line, add:

```
# Or Google Gemini (ADR 0011): used when no Anthropic key is set, or with LLM_PROVIDER=google.
# A free key from aistudio.google.com works for testing; on the free tier Google may use prompts to improve its products.
GEMINI_API_KEY=
LLM_PROVIDER=auto
GEMINI_MODEL_FRONTIER=gemini-pro-latest
GEMINI_MODEL_STANDARD=gemini-flash-latest
GEMINI_MODEL_SMALL=gemini-flash-lite-latest
```

- [ ] **Step 9: Run the backend tests and typecheck, and check the running API**

Run: `pnpm --filter @onehuman/backend test && pnpm --filter @onehuman/backend typecheck`
Expected: PASS, including the six `provider.test.ts` tests; no type errors. If TypeScript rejects passing `geminiParams(…)` to `generateContentStream` or pushing a chunk into `GeminiResponseLike[]`, adjust the agent-kit types to the SDK's (the SDK's `genai.d.ts` is the reference), never with `as any`, and re-run Step 5.

`pnpm dev` restarts the API and worker on change. Run: `curl -s localhost:3000/health`
Expected (no key on this machine yet): `{"ok":true,"llm":"offline","provider":"offline","packs":25}`.

- [ ] **Step 10: `pnpm evals:live` with Gemini, paced for a free key**

Add to `evals/src/live.test.ts` (import `paced` from `./live-lib.ts`):

```ts
  it('spaces calls out to stay under a rate limit', async () => {
    let clock = 0;
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      clock += ms;
    };
    const instant: LiveComplete = async () => ({ json: null, costUsd: 0 });
    const slow = paced(instant, 30, sleep, () => clock);
    const req = { stage: 'review', tier: 'standard', system: '', user: '', schema: {} } as const;
    await slow(req);
    await slow(req);
    clock += 500;
    await slow(req);
    expect(waits).toEqual([2000, 1500]);
  });

  it('does not wait when no rate is given', async () => {
    const waits: number[] = [];
    const fast = paced(async () => ({ json: null, costUsd: 0 }), 0, async (ms) => void waits.push(ms));
    await fast({ stage: 'review', tier: 'standard', system: '', user: '', schema: {} });
    await fast({ stage: 'review', tier: 'standard', system: '', user: '', schema: {} });
    expect(waits).toEqual([]);
  });
```

Run: `pnpm --filter @onehuman/evals exec vitest run src/live.test.ts`
Expected: FAIL — `paced` is not exported.

Add to `evals/src/live-lib.ts`:

```ts
/** Spaces calls out to stay under a rate limit (a free Gemini key allows only a few requests a minute). 0 means no limit. */
export function paced(
  complete: LiveComplete,
  rpm: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): LiveComplete {
  if (rpm <= 0) return complete;
  const gap = 60_000 / rpm;
  let next = -Infinity;
  return async (req) => {
    const wait = next - now();
    if (wait > 0) await sleep(wait);
    next = now() + gap;
    return complete(req);
  };
}
```

In `evals/src/live.ts`:
- Replace the key check with one that accepts either provider:

```ts
const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
if (!claudeKey && !geminiKey) {
  console.log('pnpm evals:live needs ANTHROPIC_API_KEY or GEMINI_API_KEY (in your shell or master-ai-backend/.env). Without one, `pnpm evals` scores the rules alone.');
  process.exit(0);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const only = arg('--pack');
const rpm = Number(arg('--rpm') ?? 0);
```

- Rename the existing Claude `complete` to `claudeComplete` (keep its `models`, `client` and `fatal`, but create `client` only when `claudeKey` is set), and add the Gemini one:

```ts
const geminiModels: Record<ModelTier, string> = {
  frontier: process.env.GEMINI_MODEL_FRONTIER ?? GEMINI_DEFAULT_MODELS.frontier,
  standard: process.env.GEMINI_MODEL_STANDARD ?? GEMINI_DEFAULT_MODELS.standard,
  small: process.env.GEMINI_MODEL_SMALL ?? GEMINI_DEFAULT_MODELS.small,
};

/** A refused Google key comes back as 400 "API key not valid", 401 or 403; an unknown model as 404. */
function geminiFatal(err: unknown, model: string): unknown {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message)))) {
    return new LiveFatalError(`Google refused the key (${err.status} ${err.message.slice(0, 160)}). Check GEMINI_API_KEY.`);
  }
  if (err instanceof ApiError && err.status === 404) return new LiveFatalError(`No Gemini model called ${model}. Set GEMINI_MODEL_* to one your key can use.`);
  return err;
}

function geminiComplete(apiKey: string): LiveComplete {
  const ai = new GoogleGenAI({ apiKey });
  return async (req) => {
    const model = geminiModels[req.tier];
    const res = await ai.models.generateContent(geminiParams(model, { system: req.system, user: req.user, jsonSchema: req.schema, maxTokens: 4000 })).catch((err: unknown) => {
      throw geminiFatal(err, model);
    });
    const read = readGemini(res, { model, jsonSchema: true });
    return { json: read.json, costUsd: costUsd(read.model, read.usage) };
  };
}

const complete = paced(claudeKey ? claudeComplete : geminiComplete(geminiKey!), rpm);
console.log(`Scoring with ${claudeKey ? 'Claude' : 'Gemini'}${rpm ? `, at most ${rpm} calls a minute` : ''}.`);
```

with `import { ApiError, GoogleGenAI } from '@google/genai';` and `GEMINI_DEFAULT_MODELS, geminiParams, readGemini` added to the `@onehuman/agent-kit` import, and `paced` to the `./live-lib.ts` import.

In the root `package.json`, let `evals:live` read the backend's `.env`, so one key serves the app and the scoring:

```json
    "evals:live": "node --env-file-if-exists=master-ai-backend/.env evals/src/live.ts",
```

Run: `pnpm --filter @onehuman/evals test && pnpm --filter @onehuman/evals typecheck`
Expected: PASS, including the two pacing tests and Task 3's tests; no type errors.

Run: `pnpm evals:live`
Expected (no key): the "needs ANTHROPIC_API_KEY or GEMINI_API_KEY" line, exit 0.

Run: `GEMINI_API_KEY=not-a-real-key pnpm evals:live --pack power-plant; echo "exit=$?"`
Expected: `Scoring with Gemini.`, then one line starting `Google refused the key (400`, and `exit=1`. (One request with a fake key, which Google refuses; nothing is billed.)

- [ ] **Step 11: Commit**

```bash
git add packages/agent-kit/src/gemini.ts packages/agent-kit/src/gemini.test.ts packages/agent-kit/src/pricing.ts packages/agent-kit/src/index.ts \
  master-ai-backend/src/config.ts master-ai-backend/src/llm/llm.service.ts master-ai-backend/src/llm/provider.test.ts master-ai-backend/src/health.controller.ts \
  master-ai-backend/src/main.ts master-ai-backend/src/worker.ts master-ai-backend/.env.example master-ai-backend/package.json \
  evals/src/live-lib.ts evals/src/live.ts evals/src/live.test.ts evals/package.json package.json pnpm-lock.yaml
git commit -m "feat(llm): Google Gemini as an optional second provider behind the gateway, and in evals:live (paced for a free key); Claude stays the default

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CI runs the smoke test, every organization type and the browser tests

**Files:**
- Create: `infra/ci/e2e.sh`
- Modify: `.github/workflows/ci.yml` (the `e2e` job)
- Modify: `.gitignore` (`.ci-logs/`)

**Interfaces:**
- Consumes: `pnpm smoke`, `pnpm e2e:sectors` (Task 2), `pnpm e2e` (Playwright, Plan 5).
- Produces: `bash infra/ci/e2e.sh` — builds, migrates, starts API + worker + the production web build, runs the three suites, stops what it started. Needs Postgres, Temporal and NATS up, and nothing else on :3000 or :5173.

The test for this task is the rehearsal in Step 3: the same script CI runs, run locally.

- [ ] **Step 1: Write `infra/ci/e2e.sh`**

```bash
#!/usr/bin/env bash
# CI's end-to-end job, runnable locally the same way. Builds, migrates, starts
# the API, the worker and the production web build, then runs the smoke test,
# every organization type, and the browser tests. Always in offline LLM mode,
# even when the .env has a key, so results are deterministic. Needs Postgres,
# Temporal and NATS (`pnpm infra:up`) and nothing else on :3000 or :5173, so
# stop `pnpm dev` first.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOGS=${LOGS:-$PWD/.ci-logs}
mkdir -p "$LOGS"
# The shell wins over the .env file (config.ts loads it without overriding).
export LLM_OFFLINE=always

for port in 3000 5173; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Something is already listening on :$port. Stop \`pnpm dev\` first." >&2
    exit 1
  fi
done

pnpm turbo run build --filter=@onehuman/backend... --filter=@onehuman/web...
[ -f master-ai-backend/.env ] || cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate

stop() {
  for port in 3000 5173; do
    pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  [ -n "${worker:-}" ] && kill "$worker" 2>/dev/null || true
}
trap stop EXIT

(cd master-ai-backend && exec node --enable-source-maps dist/main.js) >"$LOGS/api.log" 2>&1 &
(cd master-ai-backend && exec node --enable-source-maps dist/worker.js) >"$LOGS/worker.log" 2>&1 &
worker=$!
pnpm --filter @onehuman/web preview --port 5173 --strictPort >"$LOGS/web.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf localhost:3000/health >/dev/null && curl -sf localhost:5173 >/dev/null && break
  sleep 1
done
curl -sf localhost:3000/health >/dev/null || { echo "The API did not start:"; tail -n 50 "$LOGS/api.log"; exit 1; }
curl -sf localhost:5173 >/dev/null || { echo "The web app did not start:"; tail -n 50 "$LOGS/web.log"; exit 1; }

pnpm smoke
pnpm e2e:sectors
pnpm e2e
```

Run: `chmod +x infra/ci/e2e.sh && bash -n infra/ci/e2e.sh && echo syntax-ok`
Expected: `syntax-ok`.

- [ ] **Step 2: Point CI at it**

In `.github/workflows/ci.yml`, replace the whole `e2e` job with:

```yaml
  e2e:
    name: End to end — smoke, every organization type, browser tests
    runs-on: ubuntu-latest
    timeout-minutes: 45
    needs: checks
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Start infrastructure
        run: docker compose -f infra/docker/docker-compose.yml up -d --wait postgres nats temporal
      - name: Browser for the web tests
        run: pnpm --filter @onehuman/web exec playwright install --with-deps chromium
      - name: Smoke test, every organization type, browser tests
        run: bash infra/ci/e2e.sh
        env:
          LOGS: ${{ github.workspace }}/ci-logs
      - name: Logs on failure
        if: failure()
        run: tail -n 200 ci-logs/*.log
      - name: Browser test traces on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: master-ai-web/test-results
          if-no-files-found: ignore
```

Add `.ci-logs/` to `.gitignore` under the existing `*.log` line.

Run: `node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log(Object.keys(d.jobs).join(','), d.jobs.e2e.steps.length)"`
Expected: `checks,e2e 9`.

- [ ] **Step 3: Rehearse the job locally**

Stop `pnpm dev` (TaskStop on its background shell; Metro and the emulator can keep running), confirm :3000 and :5173 are free, then:

Run: `bash infra/ci/e2e.sh > .superpowers/sdd/2026-10-13-plan-7-final-pass/ci-rehearsal.log 2>&1; echo "exit=$?"; grep -E "Smoke test passed|organizations:|passed|failed" .superpowers/sdd/2026-10-13-plan-7-final-pass/ci-rehearsal.log | tail -6`
Expected: `exit=0`, `Smoke test passed.`, `20 organizations: 20 passed, 0 failed`, and Playwright's `10 passed`.

Then confirm the script stopped what it started (`lsof -ti tcp:3000 -sTCP:LISTEN` prints nothing) and start `pnpm dev` again in the background, as before (`pnpm dev > .superpowers/sdd/2026-10-13-plan-7-final-pass/dev.log 2>&1`), and wait for `curl -sf localhost:3000/health` and `curl -sf localhost:5173`.

If Playwright fails only against the production build, that's Review Focus item 5: debug it (systematic-debugging), fix the web app with a test, and ledger it.

- [ ] **Step 4: Commit**

```bash
git add infra/ci/e2e.sh .github/workflows/ci.yml .gitignore
git commit -m "ci: the end-to-end job runs the smoke test, every organization type and the browser tests from one script

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Decision records, CLAUDE.md rules, README and the known gaps

**Files:**
- Create: `evals/src/docs.test.ts`
- Create: `docs/adr/0009-organization-types-and-the-case-lifecycle.md`
- Create: `docs/adr/0010-roles-invites-and-gate-approvals.md`
- Create: `docs/adr/0011-gemini-as-a-second-model-provider.md`
- Create: `docs/known-gaps.md`
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: `ORG_TYPES` from `@onehuman/schemas`; the root `package.json` scripts, including `e2e:sectors` from Task 2.

- [ ] **Step 1: Write the docs guard test**

Create `evals/src/docs.test.ts` (it lives in the evals package because that package already checks the repository's content — packs and test sets — and runs in CI's `checks` job):

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORG_TYPES } from '@onehuman/schemas';

/** The docs people read first must match the repository: links resolve, every decision and command is listed. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const ADRS = readdirSync(join(ROOT, 'docs/adr')).filter((f) => f.endsWith('.md')).sort();
const DOCS = ['README.md', 'CLAUDE.md', 'evals/README.md', 'docs/architecture-plan.md', 'docs/packs.md', 'docs/known-gaps.md', ...ADRS.map((f) => `docs/adr/${f}`)];

/** Relative markdown links, without their #anchor; web links and same-page anchors are skipped. */
function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((href) => !/^(https?:|mailto:|#)/.test(href))
    .map((href) => decodeURIComponent(href.split('#')[0]!));
}

describe('the docs', () => {
  it.each(DOCS)('%s links only to files that exist', (doc) => {
    expect(relativeLinks(read(doc)).filter((href) => !existsSync(resolve(ROOT, dirname(doc), href)))).toEqual([]);
  });

  it('decision records are numbered 0001 upwards with no gaps, and README links each one', () => {
    expect(ADRS.map((f) => f.slice(0, 4))).toEqual(ADRS.map((_, i) => String(i + 1).padStart(4, '0')));
    const readme = read('README.md');
    expect(ADRS.filter((f) => !readme.includes(`docs/adr/${f}`))).toEqual([]);
  });

  it('README or CLAUDE.md explains every root command', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts as Record<string, string>);
    // These four are what `pnpm turbo run build typecheck test` (and lint) runs; the docs name that instead.
    const viaTurbo = new Set(['build', 'typecheck', 'test', 'lint']);
    const text = read('README.md') + read('CLAUDE.md');
    const named = (s: string) => new RegExp(`pnpm ${s.replace(/[:]/g, '\\:')}(?![\\w:-])`).test(text);
    expect(scripts.filter((s) => !viaTurbo.has(s) && !named(s))).toEqual([]);
  });

  it('README names every ready-made organization type', () => {
    const readme = read('README.md');
    expect(ORG_TYPES.filter((t) => !readme.includes(t.name)).map((t) => t.name)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @onehuman/evals exec vitest run src/docs.test.ts`
Expected: FAIL — `docs/known-gaps.md` doesn't exist (ENOENT); neither README nor CLAUDE.md names `pnpm e2e:sectors` or `pnpm infra:down` (`pnpm e2e` and `pnpm e2e:mobile` are already in CLAUDE.md); README doesn't link ADRs 0001–0003, 0005 and 0006; README doesn't name the types by their exact names (for example "Power plant & utilities").

- [ ] **Step 3: Write ADR 0009**

Create `docs/adr/0009-organization-types-and-the-case-lifecycle.md`:

```markdown
# 0009. Organization types first, and every request a case through 8 stages

Date: 2026-10-13 · Status: accepted

## Context
ONEHUMAN OS was built for small businesses: the owner typed their industry and got a pack of agents, records and rules ([ADR 0003](0003-industry-adaptation.md)). The owner wants it to fit any organization — a power plant, a lender, a hospital, a municipality — and wants every piece of work to move the same way: a request comes in, it is checked, classified, assigned, approved when the rules say so, done, verified and reported. AI agents do the work; named people approve. No model is fine-tuned. The full design is the [organization types and case lifecycle spec](../superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md).

## Decision
- **Organization type first.** Signup asks for one of five sectors (Energy & Heavy Industry; Trade, Logistics & Tourism; Finance & Development; Technology & Innovation; Essential Public & Service), then one of its three ready-made types or the owner's own words. Own words build on the ready-made type the words match, else on the closest type the sector lists as similar (`other_org_types`), else on the sector's base pack (`composeForSector`). With a model, the generator designs the lifecycle too, under the same validation. `tenants` keeps `sector`, `org_type` and the owner's words in `industry`.
- **The lifecycle is pack content.** Packs gain `sector` and `lifecycle`: the case label (Work order, Loan application, Patient case…), the 8 stage names in the organization's words, priorities P1–P4 with response and resolution hours, approver roles, urgent words, and categories with their keywords, required details and checks, not-eligible rules, approval and sign-off rules and the workflow that does the work. Lifecycles merge down `extends`, nearest pack wins; `core-business` carries the generic names, so every pack resolves to a complete lifecycle. Category rules compile into ordinary pack policies (`lifecycle.<category>.approve` and `.signoff`). Existing workspaces receive a lifecycle through the pack update banner, which only adds.
- **Every request is a case.** New tables `cases`, `case_stages` and `workspace_counters` (numbers like `WO-0042`), plus `goals.case_id` and case gates in `approval_requests`, all under RLS and audited. `caseWorkflow` runs one `stageWorkflow` per stage: request, review, classify, assign, approve, execute, close, and always report. A not-eligible review, a rejected gate, a cancel or an escalation ends the case early and the later stages are skipped. A sign-off that isn't verified sends the work back once; a second failure escalates.
- **Model or rules, the same contract.** Request and report are deterministic. Review, classify, assign and close ask the model for a zod-validated answer (one repair round), which is merged under the pack's rules; with no model or no valid answer, the offline strategy decides. P1 cases never wait for missing details: the work starts while the details are asked for.
- **Gates are policy decisions.** Stage 5 and the stage 7 sign-off are the catalog tools `case.proceed` and `case.close`, held only by the Case coordinator agent and decided by Cedar like any other action, with the case's category, priority, risk and source as context. Evaluation fails closed: an unknown amount under an amount rule needs approval. Amounts come from the request: a trusted person's stated amount wins; from outside, a stated amount may raise the gate amount but never lower it.
- **Stage 6 is the existing goal engine.** It starts a goal from the case file with the category's workflow as the preferred plan, skips plan review (stage 5 replaced it), and keeps action-level policy, approvals and phone delegation as they were.
- **Requests from anywhere.** New request in both apps and the Workflows gallery (trusted); a public form per company at `/r/<tenantId>/<formKey>` (customers, untrusted); `POST /intake/<tenantId>/cases` with a bearer key for systems and partners (untrusted, idempotent on `externalRef`); flagged routine answers become cases. Intake keys are hashed, belong to a workspace, are shown once and are checked under the tenant's RLS using the tenant id in the URL. Untrusted words are wrapped as untrusted data in every prompt and the stage-6 goal runs as inbound.
- **Quality without fine-tuning.** Each ready-made type was researched from Indian rules and practice: its pack, playbooks for the knowledge base, worked examples in the stage prompts, and a scored test set (16 suites, about 150 requests). `pnpm evals` scores the rules in CI (category and priority at least 90%, review at least 80%, gates 100%); `pnpm evals:live` scores the model. Test-set requests never go into worked examples.

## Consequences
- People see cases; goals are the work inside stage 6. Reports cover each case's stages, its work, its deadline and whether it keeps coming back.
- The sector content is researched, not expert-reviewed: the open questions are listed in [known gaps](../known-gaps.md).
- Not built: amounts worked out from records (order lines × price list), two-tier approval, WhatsApp and email intake, people working stages from a queue, and data visibility per role beyond the approvals inbox.
- Tested by `pnpm smoke` (one organization per sector plus the edge cases), `pnpm e2e:sectors` (every ready-made type and one own-words type per sector), the browser tests and the phone flows.
```

- [ ] **Step 4: Write ADR 0010**

Create `docs/adr/0010-roles-invites-and-gate-approvals.md`:

```markdown
# 0010. Named roles approve: invites, approver roles and who may decide

Date: 2026-10-13 · Status: accepted

## Context
Until now one owner approved everything. Organizations don't work that way: a hot-work permit is the safety officer's call, a loan is the credit manager's, a discharge bill the insurance desk's. The case lifecycle ([ADR 0009](0009-organization-types-and-the-case-lifecycle.md)) names a role for each approval and sign-off, so the people holding those roles need their own logins, on web and phone, and the platform must enforce who may decide.

## Decision
- **Two kinds of role.** The access role (`owner`, `admin`, `member`) decides what a person may change. Approver roles (`principals.approver_roles`) are ids from the pack's lifecycle roles, such as `safety-officer` or `credit-manager`; a person may hold several, and an unknown role id is refused.
- **Invites.** The owner or an admin adds a person with a name, email, access role and approver roles. The server stores a hashed token that expires after 7 days and returns a link, `<web>/invite/<tenantId>/<token>`, which the owner sends themselves (there is no email connector yet). Opening the link shows the company and the roles; the person sets a password, or signs in with their existing one and joins a second company. Accepting runs under the tenant's RLS using the tenant id in the link, so no new global lookup is needed. A link works once, can be withdrawn, and dies with the access of the admin who made it. Invites are audited as `member.invited` and `member.joined`.
- **Access is read on every request.** Removing or demoting someone takes effect at once, not when their 7-day session ends. An open live connection of a removed person closes at its next reconnect.
- **Routing.** A gate goes to the role its rule names. If no active person holds that role, it goes to the owner and the approval says why ("Nobody holds the safety officer role yet"). Pushes for a role-routed approval go to its holders and the owner; operational pushes go to the owner and admins.
- **Who may decide.** The owner may decide anything. An admin may decide anything routed to the owner, plus their own roles. A member may decide only approvals for roles they hold; anyone else gets 403. The first decision wins (the row is locked). Each decision is signed with the person's device key and verified, as before ([ADR 0004](0004-auth-and-signed-approvals.md)), and the role check reads the database at decision time.
- **Each person's inbox.** Both apps open approvals on *Mine* (`GET /approvals?mine=true`); the owner and admins can switch to *All*. The daily pulse counts only the decisions that person can make. On a shared phone, saved approvals and decisions queued offline are kept per person, and signing in or out clears what was on screen.
- **Staff who also log in.** A team-directory record (someone the AI phones) can be linked to a login, so one person both takes calls and approves.
- **What each access role sees.** Everyone in the company sees all cases. Only the owner and admins change settings, the pack, rules, request keys and the team, or use the kill switch. The web hides those pages from members and the API refuses them.

## Consequences
- The right person approves from their own phone, with a fingerprint-signed decision, and the audit log shows who.
- Two-tier approval (a role, then the owner for very large amounts) is not supported; a rule names one role. SSO and passkeys are still later ([ADR 0004](0004-auth-and-signed-approvals.md)). Data visibility per role, beyond the approvals inbox, is out of scope.
- Tested by the smoke test (invites, refusals, removal, demotion, a second company) and by `pnpm e2e:sectors`, where in every organization type the role holder approves and a member without the role is refused.
```

- [ ] **Step 4b: Write ADR 0011**

Create `docs/adr/0011-gemini-as-a-second-model-provider.md`:

```markdown
# 0011. Google Gemini as an optional second model provider

Date: 2026-10-14 · Status: accepted

## Context
Every model call goes through one gateway, `LlmService` ([ADR 0005](0005-llm-gateway-and-stateless-agent-steps.md)), and until now it spoke only to Claude. Without a key it runs on deterministic offline rules, which is what tests and CI use. The owner wanted to test the live path (real model answers in the case stages, agents and the scored test sets) with a Google key, rather than get a Claude key first. The README already listed "primary LLM providers per data class" as an open decision.

## Decision
- **Claude stays the default.** The gateway uses Claude when `ANTHROPIC_API_KEY` is set, otherwise Gemini when `GEMINI_API_KEY` is set, otherwise the offline rules. `LLM_PROVIDER=google` forces Gemini; `LLM_OFFLINE=always` forces the rules. `GET /health` says which provider answers.
- **Same tiers, same contract.** `GEMINI_MODEL_FRONTIER`, `_STANDARD` and `_SMALL` map the gateway's tiers (defaults: Google's Pro, Flash and Flash-Lite "-latest" aliases). Calls stay single-turn. JSON answers use the same JSON Schema (`responseJsonSchema`), and tools are offered as function declarations with the same schemas. Only the first tool call is taken, since Gemini has no switch to turn off parallel calls and agents run one step at a time. The model's thinking never reaches people. A blocked prompt or answer is a refusal. A cut-off or malformed tool call never runs. Rate limits and server errors move to the fallback tier, as with Claude.
- **One mapping, shared.** The request and response mapping is plain code in `packages/agent-kit/src/gemini.ts`, used by the backend and by `pnpm evals:live`, like the price table. Only `LlmService` and `evals/src/live.ts` import the Google SDK (`@google/genai`).
- **Metering as billed.** Tokens are counted the way Google bills them (cached input apart, thinking as output), at approximate list prices per model family.

## Consequences
- A Google key makes the live path testable end to end. Its scores measure Gemini, not the Claude models the prompts were written for, so they are not a quality bar for what ships.
- On Google's free tier, prompts may be used to improve Google's products and requests per minute are low. Use it with test data only; `pnpm evals:live --rpm` paces calls, and the live sector run goes one organization at a time.
- Prompt caching is implicit on Gemini, and the server-side refusal fallback is Claude-only. Choosing a provider per data class (for example, keeping restricted data on one provider) is still open.
```

- [ ] **Step 5: Write `docs/known-gaps.md`**

First check three items that later work may already have fixed, and leave out any that is fixed:
- `grep -n "queryClient" master-ai-web/src/lib/api.ts master-ai-web/src/lib/session*.ts` — if signing in or out clears the web query cache, drop "The web app keeps the last person's data in memory across sign-in".
- `grep -n "limit(" master-ai-backend/src/approvals/*.ts` — if the *Mine* filter runs before the limit, drop the approvals-list line.
- `grep -rn "pushToManagers\|pushToRole" master-ai-backend/src/cases/stages.service.ts` — if needs-details pushes reach the person who filed the case, drop that line.

Also drop any line Tasks 2–5 fixed (for example "gate reasons can name a tool", if Task 2 found and fixed it). Then create `docs/known-gaps.md`:

```markdown
# Known gaps

Things the build doesn't handle yet. Reviews found them while Plans 2–6 were built, and each was left for later because it is small, rare or needs a decision. Each line says what a person would notice. None of them lets someone decide what they shouldn't, or loses a decision.

## Cases and the 8 stages
- Cancelling a case at the moment a stage starts can leave that stage running for a while; the cancel isn't passed on to it.
- The reason given when cancelling a case isn't kept.
- Details added while the review is already running are read on the next round, not the current one.
- If the signal carrying a decision is lost, the gate waits until it expires and the case is escalated.
- A step that is retried can write its audit line twice.
- Pausing at the exact moment a stage resumes can miss the pause.
- If Temporal is down when a case is created, the case is saved but doesn't start.
- Cancelling a case that has just finished answers with its old state.
- The public form's page and its sending share one rate limit.
- A note the owner writes on a case can reach the customer who sent it through the public form.
- When the main model fails and a smaller one answers, the audit log doesn't say so.
- Cancelled cases count as finished within their deadline in reports.
- One report sentence reads "The work ended running."
- Case titles keep a final full stop and can be cut after "St.".
- Amounts are read from the request, not worked out from records (order lines × price list).
- The stage service has no unit tests of its own; the smoke test and `pnpm e2e:sectors` cover it end to end.

## Roles and invites
- Nothing tests that an invite link from one company can't be used in another (the database refuses it).
- The approvals list is cut at 200 before it is filtered to *Mine*, so in a very busy company some of yours can be missing.
- Two people accepting invites with the same email at the same moment can get an error instead of one joining.
- The owner can't link their own team-directory record to their login, and linking a record that is already linked moves it without a warning.
- Opening an invite needs the company's setup to be installed.
- Nobody gets a push when someone joins as an admin or approver.
- "Needs details" pushes go to the owner and admins, not to the person who filed the case.
- Some errors show ids; a few phrases read oddly ("The owner rejected", "1 decision need you").
- `WEB_URL` isn't checked when the API starts.
- Two-tier approval (a role, then the owner for very large amounts) isn't supported.

## Web app
- Dialogs and the side drawer don't keep keyboard focus inside them, or return it when closed.
- Text inputs are 36px tall at phone width, under the 44px target.
- Some errors show raw field names ("amountInr: …"), and the public form's error text is technical.
- The company's brand colour barely shows.
- Owner-only pages open by URL for members; the server refuses everything on them.
- With the system theme on a light phone or computer, the dark glows stay.
- Gate cards repeat their reason, and say "track record".
- The case page checks for changes every 5 seconds as well as listening live.
- Nothing tests the live stage's spin with reduced motion.
- Red Hat Display bold is synthesized in one place.
- Canvas labels are under 13px near 1024px wide.
- Stage-dot links have long names for screen readers.
- Stopped cases show different dots in the list and on the canvas.
- The names of nodes that need details show outside the requester's view.
- The Agents page header repeats.
- An empty "Needs: ." line can show.
- Case search isn't on the server: outside the open tabs, the list shows the newest 200.
- The web app keeps the last person's data in memory across sign-in.

## Mobile app
- In reject mode, Approve stays visible and there's no Cancel.
- Agent jobs has no back button.
- A few screens read names from the first workspace instead of the case's own.
- The Approvals badge also counts decisions already queued offline.
- `pnpm e2e:mobile` doesn't restore Android's animations if interrupted with Ctrl-C.
- On iPhone the keyboard may cover the rejection note (not checked on iOS).
- The Cases list isn't virtualised, and the case screen checks every 5 seconds.
- Some wording is stale; the colour guard misses rgba and named colours; sending queued decisions isn't tested across two people.
- One approval reason line can name a tool (the policy engine's earned-autonomy line).
- A decision queued offline is dropped if the session expired meanwhile.
- Saved approvals aren't encrypted on the phone.

## Sector content
- Some approval reasons show role names in lower case.
- Everyday words can make a request P1 ("fire extinguisher refill", "smoke detector testing").
- `pnpm pack:check` skips the quality bar when a draft has no `sector:`, and fails on paths with spaces.
- Nothing enforces that every category has test-set requests, or pins worked examples to the pack's rules.
- The travel-agency upgrade test uses the new pack as the old snapshot.
- Some case labels differ from the design's Appendix A, and composed packs can pick odd labels.

## Questions for an expert
The sector content was researched from public sources, not reviewed by people who work in these sectors. These calls need one:
- Energy: should near misses be P1 or P3?
- Manufacturing: should planned shutdowns be approved by the shift in-charge rather than the plant head?
- Construction snags and GST time-bars depend on dates; rules that read dates need code.
- IT services and digital agencies have no case type for police or court orders.
- NGOs and CA firms can name only one approving role per category.
- A proprietor CA firm's payment approver is called "finance manager".
- Software & SaaS: privacy officer or founder sign-off?
- Legal facts were taken from news summaries and need a lawyer's check: DPDP dates, the 2026 IT Rules, the TCS rate, DGCA, FCRA 2026, Income-tax Act 2025 sections.
- Municipal time limits use one state's list (Haryana).
```

- [ ] **Step 6: Add the new rules and commands to `CLAUDE.md`**

In `## Commands`, after the `pnpm e2e:mobile` line, add:

```markdown
- `pnpm e2e:sectors` — every organization type end to end against a running `pnpm dev`: the 15 ready-made types and one typed in the owner's own words per sector. Each invites its role holders and a member, sends a real request through its door (New request, public form or intake API) and checks the gates, the sign-off and that nothing people read names a tool. `--only <id>` runs one. With a model configured it runs one per sector and reports the model's judgement instead of failing on it
- CI's end-to-end job is `infra/ci/e2e.sh` (smoke, `e2e:sectors`, Playwright on the production web build). Rehearse it locally after `pnpm infra:up`, with `pnpm dev` stopped
```

In `## Rules that are easy to break`, add after the "Agents never decide permissions" rule:

```markdown
- Case gates are policies on `case.proceed` (stage 5) and `case.close` (the stage 7 sign-off). Only the Case coordinator agent holds those tools. A category's approval and sign-off rules compile to pack policies (`lifecycle.<category>.approve` / `.signoff`); never decide a gate in code or in a prompt ([ADR 0009](docs/adr/0009-organization-types-and-the-case-lifecycle.md)).
- Public routes take the tenant id in the URL (`/intake/:tenantId/…`, `/invites/:tenantId/:token`) and check a hashed key or token under that tenant's RLS. Don't add a global lookup or a security-definer function for them ([ADR 0010](docs/adr/0010-roles-invites-and-gate-approvals.md)).
- Stage outputs are zod-validated case-file parts. A model's answer is parsed with `MODEL_STAGE_SCHEMAS` (one repair round), then merged under the rules (`mergeReview`, `mergeClassify`, …) into the typed `CaseFile` part (`packages/schemas/src/case.ts`). A model answer never writes the case file or case columns directly; without a valid answer the offline strategy decides.
- Eval requests never go into pack `lifecycle.examples`: examples teach the model, evals test it. `evals/src/suites.test.ts` fails if one does.
- Model providers plug in behind `LlmService` only. Claude is the default; Gemini (`GEMINI_API_KEY`, `LLM_PROVIDER`) is optional, and its request/response mapping lives in `packages/agent-kit/src/gemini.ts` so `pnpm evals:live` shares it. Business logic never names a provider or a model ([ADR 0011](docs/adr/0011-gemini-as-a-second-model-provider.md)).
- `LLM_OFFLINE=always` in the shell beats the `.env` file (`config.ts` loads it without overriding). CI and offline checks use it so a key in `.env` can't change their results.
```

- [ ] **Step 7: Rewrite `README.md`**

Replace the whole file with:

````markdown
# ONEHUMAN OS

One agent-native platform for any organization. At signup the owner picks the organization type, and the platform sets itself up for it: the 8 stages every request runs through, named in that organization's own words, its case types, who approves and signs off, its agents, records and KPIs. Agents do the work, a policy engine (not the AI) decides what they may do, and the people holding the right roles approve from web or phone with a signed decision.

This repository implements the [architecture plan](docs/architecture-plan.md) and the [organization types and case lifecycle design](docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md). Every layer is real and connected end to end, and all of it runs with no AI key.

## What works today

| Flow | How it works |
| --- | --- |
| **Organization type first** | Signup asks for the sector, then the organization type: one of the 15 ready-made types below, or the owner's own words. Own words build on the ready-made type they match, or the closest one the sector lists as similar (a cement grinding unit gets the manufacturing plant's stages), or the sector's defaults; with a model, the generator designs one. The owner previews the stages, case types, roles, agents and records, then installs ([ADR 0009](docs/adr/0009-organization-types-and-the-case-lifecycle.md)). |
| **Every request is a case** | Each request runs through 8 stages in the organization's words — for a power plant: Work request → Permit-to-work check → Classification & priority → Assignment → Safety (HSE) approval → Execution → Verification & close-out → Report. Agents do each stage; approval is skipped when no rule needs it; the work itself is stage 6; a sign-off that isn't verified sends it back once. Each case gets a number (WO-0042), a deadline from its priority, and a report. |
| **Requests from anywhere** | **New request** on web and phone, the Workflows gallery, and a flagged routine answer start cases from inside. Customers use a public form link; systems and partners post to an intake API with a key (repeats are ignored). Outside words are treated as untrusted data in every prompt. Keys are made in **Settings → Requests**. |
| **Named roles approve** | The owner invites people from the Team page with an access role (admin or member) and approver roles from the pack (safety officer, credit manager, insurance desk…). Each gate goes to the person holding its role, or to the owner when nobody does, with the reason. Members can decide only their own roles; everyone else is refused. Both apps open the approvals inbox on *Mine* ([ADR 0010](docs/adr/0010-roles-invites-and-gate-approvals.md)). |
| **Goal → plan → agents** | The work in stage 6 is a durable Temporal workflow. The orchestrator plans a task graph from the case file; each task runs as its own workflow where an agent proposes one tool call per step. |
| **Policy gate** | Every proposed action, and every case gate, is risk-scored (action type, money, reversibility, external reach, data sensitivity, track record) and checked by Cedar policies compiled from the pack: Levels 1–3 run, Level 4 waits for approval, Level 5 is blocked. Kill switches, allow-lists, money budgets and prompt-injection guards are Cedar rules too. |
| **Signed approvals** | Each device has an Ed25519 key (browser storage on web; keychain + Face ID / fingerprint on mobile). Decisions are signed and verified server-side; forged signatures are refused. The workflow sleeps until the decision arrives, for days if needed. Rejections go back with the approver's note. |
| **Audit** | Every state change is an append-only, hash-chained event. The audit explorer verifies the chain and replays any goal step by step. |
| **Tenancy** | Postgres row-level security on every table; the app connects as a role that cannot bypass it. |
| **Live everywhere** | Audit events stream over NATS to WebSocket clients; agent text streams over SSE. A case's stages advance live on screen. |
| **Earned autonomy** | After 5 unchanged approvals of the same action, the platform suggests letting that agent do it alone. The owner grants or revokes in one tap; amount limits still apply. Case gates never become automatic. |
| **Work done by the team, by phone** | When work needs a person, the agent hands it to the staff member in charge and a durable workflow calls them: **assign**, **follow up** before it is due, **confirm** when it is due. Unanswered calls are retried; calls happen only in working hours. Declined, blocked or not-done work comes back to the owner. Real calls go through Twilio (Indian-English voice and speech recognition) or run in a built-in simulator ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)). |
| **Routines: manual or automatic** | Repeating check-ins (daily work report, stock check, bookings check-in) come from the pack. Each one is **Manual** (people fill in a short form) or **Automatic** (the AI phones each person and fills in the answers). A live board shows who has reported, and any problem raised becomes a case in one click ([ADR 0008](docs/adr/0008-routines-manual-or-automatic.md)). |
| **Reports in plain words** | Every step is told as a sentence, never as tool names or data. Each case has a report: its stages, the work done, whether it met its deadline, and whether it keeps coming back. **Reports** collects them by period; owners copy, print, save as PDF or share from the phone. |
| **Quality without fine-tuning** | Each ready-made type was researched from Indian rules and practice: its pack, playbooks for the knowledge base, worked examples for the stage prompts, and a scored test set of real-sounding requests (16 sets, about 150 requests). `pnpm evals` scores the rules on every build; `pnpm evals:live` scores the model. |
| **Web app (Glow)** | A dark violet-navy look with warm orange actions, inspired by n8n.io. Home, Cases (with each case's 8 stages as dots), the case page (the stages on an animated canvas, the case file in sentences, the report), Approvals, Team with invites and roles, Reports, Routines, Calls, Records, Workflows, Agents, Knowledge, the Industry pack, Audit and Settings. Works at phone width. |
| **Phone app (Glow)** | Expo app with Cases, Approvals (with a badge), Calls, Pulse and Settings. The case screen shows the 8 stages with the live one pulsing (still under reduced motion); the approval screen asks the question in plain words with the risk and evidence, approves with the fingerprint and rejects with a note. Saved approvals work without signal and are kept per person on a shared phone. |

### Ready-made organization types

| Sector | Organization types |
| --- | --- |
| Energy & Heavy Industry | Power plant & utilities · Manufacturing plant · Construction & infrastructure |
| Trade, Logistics & Tourism | Logistics & transport · Wholesale & retail trade · Travel agency & tour operator |
| Finance & Development | Lender (NBFC, microfinance, co-op bank) · Accounting & tax firm · NGO & development programme |
| Technology & Innovation | Software & SaaS company · IT services & support · Digital agency |
| Essential Public & Service | Hospital & clinic · School, college & coaching · Municipal & citizen services |

### Verified end to end

- [`pnpm smoke`](master-ai-backend/scripts/smoke.ts): signup → pack → goal → plan → signed approval (a forged signature is refused) → execution → realtime → audit verification → RLS isolation → kill switch → phone delegation; then one organization per sector runs a case through all 8 stages, plus the public form, the intake API, needs-details, cancel, a rejected gate, not-eligible, the kill switch on cases, invites, role refusals, removal and demotion.
- [`pnpm e2e:sectors`](master-ai-backend/scripts/sectors.mts): all 15 ready-made types and one typed in the owner's own words per sector. Each invites its role holders and a member, sends a real request from its test set through the door it would really use, and checks the stage names, category, priority, who approved and signed off, that the member was refused, and that nothing people read names a tool or shows an id.
- `pnpm e2e` (Playwright, Chromium): signup to report in the browser at desktop width — sector, type, preview, install, a new request, the stages advancing live, approval by the role holder in a second browser, sign-off, the report — plus the main pages at 390px phone width.
- `pnpm e2e:mobile` (Maestro, Android emulator, Expo Go): a role holder sees only their approvals and approves with the fingerprint-signed key; a member sees none; a new request from the phone runs its stages.
- `pnpm evals`: the 16 test sets, scored offline in every build.

CI runs the build, typecheck and unit tests (with the test sets) on every push, then the smoke test, every organization type and the browser tests against the production web build ([ci.yml](.github/workflows/ci.yml), [infra/ci/e2e.sh](infra/ci/e2e.sh)).

## Repository

```
master-ai/
├─ master-ai-backend/   NestJS modular monolith (API) + Temporal worker (agents, cases); scripts/ has the smoke and sector runs
├─ master-ai-web/       Web app: React + Vite + Tailwind + TanStack Query + motion; e2e/ has the Playwright tests
├─ master-ai-mobile/    Phone app: Expo SDK 57 + Expo Router + Reanimated; e2e/ has the Maestro flows
├─ packages/
│  ├─ schemas/          Zod schemas + types for packs, cases, API and events (single source of truth)
│  ├─ agent-kit/        Tool catalog, pack resolution, lifecycles, offline stage strategies, stage prompts
│  ├─ policy/           Risk scoring + Cedar policy engine
│  ├─ sdk/              Typed API client, realtime client, approval signing, case views
│  └─ ui/               Glow design tokens for web (CSS variables) and mobile
├─ packs/               5 sector packs, 15 organization-type packs, core-business and the crm/bookings/orders/projects bases
├─ evals/               Scored test sets (suites/) and their runners; the sector run's plan
├─ infra/               Local stack (docker/: Postgres + pgvector, Temporal on Postgres, NATS JetStream) and CI's end-to-end script (ci/)
└─ docs/                Architecture plan, decision records (adr/), pack guide, known gaps
```

The backend modules map one-to-one to the plan's services (identity, orchestrator, workflows, cases, agent runtime, LLM gateway, policy and approval, knowledge, connector gateway, pack registry, audit, KPIs, notifications), so any one of them can be split into its own service later.

## Run it

Prerequisites: Node 24 (`nvm use`), Docker, and pnpm via Corepack (`corepack enable pnpm`).

```bash
pnpm install
pnpm infra:up                                   # Postgres, Temporal (+ UI on :8233), NATS
cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate
pnpm dev                                        # shared packages (watch) + API :3000 + worker + web :5173
```

Open http://localhost:5173, choose **Set up your organization**, pick a sector and a type. `pnpm infra:down` stops the local stack.

- **Mobile:** `pnpm --filter @onehuman/mobile start` (Metro on :8082), then open it in Expo Go. The app finds the API on the same machine automatically; set `EXPO_PUBLIC_API_URL` to override. On the Android emulator, run `adb reverse tcp:3000 tcp:3000` and open `exp://127.0.0.1:8082`. Remote push needs a development build (`eas build --profile development`); Expo Go removed push on Android in SDK 53.
- **Real models:** set `ANTHROPIC_API_KEY` in `master-ai-backend/.env` and restart `pnpm dev`. Model tiers: frontier `claude-opus-5-5`, standard `claude-sonnet-5-5`, small `claude-haiku-5-5` (configurable). For testing you can use Google Gemini instead: set `GEMINI_API_KEY` (a free key from aistudio.google.com works; use test data only, as Google may use free-tier prompts) and, if your key can't use Pro, `GEMINI_MODEL_FRONTIER=gemini-flash-latest` ([ADR 0011](docs/adr/0011-gemini-as-a-second-model-provider.md)). With no key the LLM gateway runs in deterministic **offline mode** (labelled `offline` in metering), which is what tests and CI use; `LLM_OFFLINE=always` keeps it there even with a key. `GET /health` shows which provider answers.
- **Requests from outside:** in **Settings → Requests**, make a form link for customers or an API key for a system or partner. A key is shown once.
- **The team:** on the **Team** page, invite people with their roles and send them the link. Installing with *sample records* also adds three staff members the AI can phone.
- **Phone calls:** give a request that needs someone on site, such as *"Make sure the hotel rooms are inspected before Friday"*. In **Settings → Phone calls to the team**, choose who answers simulated calls. With **You do, in this app** (the default), each call rings at the bottom right of the web app and you answer as the staff member by typing, using quick replies, or speaking (Chrome). With **A simulated staff member**, calls answer themselves. **Fast schedule**, on by default, puts seconds between calls instead of hours.
- **Routines:** open **Routines**, switch on a check-in and press **Call everyone now**. Use **Fill in** for the manual side.
- **Real phone calls (Twilio):**
  1. Create a Twilio account. On a free trial, verify each number you want to call under *Phone Numbers → Verified Caller IDs*. Get a Twilio number, and enable **India** under *Voice → Settings → Geo permissions*.
  2. Expose the API so Twilio can reach it: `brew install cloudflared`, then `pnpm tunnel`, and copy the `https://….trycloudflare.com` address it prints.
  3. In `master-ai-backend/.env`, set `PUBLIC_URL` (that address), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`, then restart `pnpm dev`.
  4. In **Settings → Phone calls to the team**, choose **Real phone calls (Twilio)**.

  The person hears an AI voice and answers by speaking, and the web app shows the conversation live. Real calls only go out between 9 am and 9 pm IST, even with fast schedule on. A quick tunnel's address changes every time it restarts, so update `PUBLIC_URL` to match.

### Checks

| Command | What it checks | Needs |
| --- | --- | --- |
| `pnpm turbo run build typecheck test` | Build, types and unit tests in every package, including the test sets | Nothing running |
| `pnpm evals` | Just the test sets, with a scorecard per organization type | Nothing running |
| `pnpm evals:live [--pack <id>] [--rpm <n>]` | The test sets with the model answering review and classification; prints the cost. `--rpm` paces calls for a free key | `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (shell or the backend's `.env`) |
| `pnpm pack:check --pack <pack.yaml> --suite <suite.yaml>` | A draft pack and its test set, before copying them into `packs/` ([guide](docs/packs.md)) | Nothing running |
| `pnpm smoke` | The whole platform end to end through the API | `pnpm dev` |
| `pnpm e2e:sectors [--only <id>]` | Every organization type end to end | `pnpm dev` |
| `pnpm e2e` | The browser tests. First time: `pnpm --filter @onehuman/web exec playwright install chromium` | `pnpm dev` |
| `pnpm e2e:mobile` | The phone flows. Needs Metro on :8082, the Android emulator with Expo Go, and Maestro 2.10.0 in `~/.maestro` | `pnpm dev` |

`pnpm e2e:sectors` also runs against a model: restart `pnpm dev` with a key set, and it runs one organization per sector, one at a time, and reports where the model judged differently from the test set. The smoke test, the browser tests and the phone flows expect offline mode. To run CI's end-to-end job locally, stop `pnpm dev` and run `bash infra/ci/e2e.sh` (it always runs offline).

## How a pack works

A pack is YAML ([example](packs/power-plant/pack.yaml)) that `extends` base packs and adds what the organization needs:

- **sector** and **lifecycle**: the case label, the 8 stage names, priorities, approver roles, and case types with their keywords, required details, checks, approval and sign-off rules and worked examples;
- **entities**: typed fields, validated on every write and rendered by the schema-driven UI;
- **agents**: role, tools, clearance level (1–4), model tier, data class, token/money/step budgets;
- **tools**: sector names over generic primitives, e.g. `booking.confirm` = `records.update` with `status: confirmed`, marked irreversible and external;
- **workflows**: task graphs the planner can use;
- **policies**: `require_approval`, `require_approval_above`, `forbid`, `forbid_above`, compiled to Cedar;
- **routines**, **playbooks** and **kpis**.

Adding an organization type means adding YAML and a test set, or letting the generator draft one. No core change is needed. The pack authoring guide is [docs/packs.md](docs/packs.md).

An installed workspace keeps a snapshot of its pack. When the base packs later gain agents, workflows, tools, policies, KPIs or lifecycle parts, the Industry pack and Team pages offer them as an update. Applying it only adds what is missing; nothing the owner already has is replaced.

## Decisions

1. [Monorepo with three app folders, modular monolith backend](docs/adr/0001-monorepo-and-modular-monolith.md)
2. [Drizzle + Cedar, and one autonomy scale for agents and actions](docs/adr/0002-drizzle-cedar-and-the-autonomy-model.md)
3. [The platform adapts to the owner's industry at signup](docs/adr/0003-industry-adaptation.md)
4. [Built-in auth now, OIDC later; device-signed approvals](docs/adr/0004-auth-and-signed-approvals.md)
5. [LLM gateway, stateless agent steps, offline mode](docs/adr/0005-llm-gateway-and-stateless-agent-steps.md)
6. [Local Temporal runs on Postgres](docs/adr/0006-temporal-on-postgres.md)
7. [Work handed to staff by phone: Twilio, with a simulator](docs/adr/0007-phone-delegation-to-staff.md)
8. [Routines: repeating check-ins, by hand or by phone](docs/adr/0008-routines-manual-or-automatic.md)
9. [Organization types first, and every request a case through 8 stages](docs/adr/0009-organization-types-and-the-case-lifecycle.md)
10. [Named roles approve: invites, approver roles and who may decide](docs/adr/0010-roles-invites-and-gate-approvals.md)
11. [Google Gemini as an optional second model provider](docs/adr/0011-gemini-as-a-second-model-provider.md)

## Not built yet

| Area | Status |
| --- | --- |
| Real connectors (WhatsApp Business, Razorpay, Tally, Gmail, MCP servers) | The sandbox connector records every outbound action in the outbox; the connector interface is in place |
| WhatsApp and email intake, and messages back to customers | Need the connectors |
| People working stages from a queue | Considered and not chosen; agents work every stage |
| Two-tier approval; amounts worked out from records | A rule names one role; amounts come from the request |
| Keycloak / OIDC, passkeys (WebAuthn), SSO | Built-in password auth + HS256 sessions; device Ed25519 keys sign approvals ([ADR 0004](docs/adr/0004-auth-and-signed-approvals.md)) |
| Data visibility per role | Everyone in a company sees all cases; the approvals inbox is per person |
| ClickHouse KPIs, Redis rate limits, object storage | Not started; public routes are rate-limited in process |
| pgvector embeddings | Column and index ready; knowledge search uses Postgres full text |
| Indian caller ID (Exotel / Plivo), Indian languages, call recording | Real calls go through Twilio, in English; Exotel or Plivo would plug in behind the same call flow ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)) |
| Field capture, A2A, digital twin, marketplace | Future layer, as in the plan |
| Terraform / Helm / Argo CD, SOC 2 | Not started |

Smaller gaps found by reviews, and the sector questions that need an expert, are listed in [docs/known-gaps.md](docs/known-gaps.md).

## Open decisions still yours

Cloud and region (AWS vs GCP Mumbai, any on-premise pilot), primary LLM providers per data class, self-hosted vs Temporal Cloud in production, pricing model, product name clearance, and the sector questions in [known gaps](docs/known-gaps.md#questions-for-an-expert). Decided in this build: monorepo with the three app folders, Drizzle + Cedar, organization type chosen by the owner at signup, every request a case through 8 named stages, named roles approving, and the Glow look.
````

Before saving, check three claims against the app and adjust the words if they differ: the power-plant stage names (`grep -n "name:" packs/power-plant/pack.yaml | head -12`), the signup button text (`grep -rn "Set up your" master-ai-web/src/routes/auth.tsx`), and the web page list (`ls master-ai-web/src/routes`).

- [ ] **Step 8: Run the docs test and the whole evals package**

Run: `pnpm --filter @onehuman/evals test`
Expected: PASS, including every `docs.test.ts` row. A broken link the test finds in `evals/README.md`, `docs/packs.md` or an older ADR is fixed in that file.

- [ ] **Step 9: Commit**

```bash
git add evals/src/docs.test.ts docs/adr/0009-organization-types-and-the-case-lifecycle.md docs/adr/0010-roles-invites-and-gate-approvals.md docs/adr/0011-gemini-as-a-second-model-provider.md docs/known-gaps.md CLAUDE.md README.md
git commit -m "docs: ADR 0009, 0010 and 0011, the case, route and provider rules in CLAUDE.md, a README for what works today, and the known gaps — guarded by a docs test

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Everything green, and the live-model run

**Files:**
- No new files. Fixes, if any, follow the rule in Task 2 Step 6.

**Interfaces:**
- Consumes: every command above.

- [ ] **Step 1: Run every check on the final tree, offline**

The checks below expect the offline rules. If the user has already put a key in `master-ai-backend/.env`, start `pnpm dev` as `LLM_OFFLINE=always pnpm dev` for this step (the shell wins over the `.env` file), and confirm `curl -s localhost:3000/health` shows `"llm":"offline"`. Start the emulator (`~/Library/Android/sdk/emulator/emulator -avd Pixel_10_Pro -no-snapshot-save -no-audio`, in the background) and Metro (`pnpm --filter @onehuman/mobile start`, in the background) if they are not running.

With `pnpm dev`, Metro and the emulator running:

Run: `pnpm turbo run build typecheck test > .superpowers/sdd/2026-10-13-plan-7-final-pass/turbo.log 2>&1; tail -8 .superpowers/sdd/2026-10-13-plan-7-final-pass/turbo.log`
Expected: every task successful.

Run: `pnpm smoke 2>&1 | tail -2; pnpm e2e:sectors 2>&1 | tail -3; pnpm e2e 2>&1 | tail -3; pnpm e2e:mobile 2>&1 | tail -5`
Expected: `Smoke test passed.`; `20 organizations: 20 passed, 0 failed`; `10 passed`; the three Maestro flows pass.

- [ ] **Step 2: The live-model run, with the key the user set**

Run: `grep -cE '^(ANTHROPIC_API_KEY|GEMINI_API_KEY)=.+' master-ai-backend/.env || true`

- **0 (no key yet):** this is one of the four stops. Ask the user to put `GEMINI_API_KEY=<their key>` in `master-ai-backend/.env` (a free key from aistudio.google.com is enough), and wait. If they decline, ledger `Task 7: Ruling: live-model run skipped — no key — the model path stays checked only by unit tests and the fake-key runs in Tasks 3 and 4`, and give them the commands below in the final message.
- **A Gemini key (and no Anthropic key):**
  1. Check which models the key can use, one tiny request each (run from the repo root so `@google/genai` resolves):

     ```bash
     node --env-file=master-ai-backend/.env -e '
     import("@google/genai").then(async ({ GoogleGenAI }) => {
       const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { retryOptions: { attempts: 1 } } });
       for (const tier of ["FRONTIER", "STANDARD", "SMALL"]) {
         const model = process.env[`GEMINI_MODEL_${tier}`] || { FRONTIER: "gemini-pro-latest", STANDARD: "gemini-flash-latest", SMALL: "gemini-flash-lite-latest" }[tier];
         try { const r = await ai.models.generateContent({ model, contents: "Reply with the word ok." }); console.log(tier, model, "→", r.modelVersion, JSON.stringify(r.text)); }
         catch (e) { console.log(tier, model, "✗", e.status, String(e.message).slice(0, 140)); }
       }
     })'
     ```

     Expected: each tier answers `"ok"` (or close) and names the model that served it. A tier that fails with 429 (a free key may have no quota for Pro) or 404 gets `GEMINI_MODEL_<TIER>=gemini-flash-latest` in `master-ai-backend/.env`; re-run until all three answer, and ledger the choice.
  2. Restart `pnpm dev` normally (TaskStop, then start it again in the background) so the API and worker pick up the key. Wait for `curl -s localhost:3000/health` to show `"llm":"online","provider":"google"`.
  3. Score one ready-made type per sector, paced for a free key:

     Run: `for p in power-plant travel-agency lender software-saas hospital; do pnpm evals:live --pack $p --rpm 8; done > .superpowers/sdd/2026-10-13-plan-7-final-pass/evals-live.log 2>&1; grep -E "^(Scoring|  model answers|Total cost)|%|refused" .superpowers/sdd/2026-10-13-plan-7-final-pass/evals-live.log | head -60`
     Expected: `Scoring with Gemini, at most 8 calls a minute.` and a scorecard per type with "model answers N, fell back to rules M". Most answers should come from the model. If most fall back with failed calls, read the log: a 400 that names a JSON Schema keyword means Gemini rejected a stage schema. Fix that in `geminiParams` with a failing test first (strip or rewrite only the keyword it names), rebuild, and re-run. Scores under the offline thresholds measure Gemini's judgement, not the plan: record them for the user.
  4. Run the five live organizations, one at a time:

     Run: `pnpm e2e:sectors > .superpowers/sdd/2026-10-13-plan-7-final-pass/sectors-live.log 2>&1; tail -30 .superpowers/sdd/2026-10-13-plan-7-final-pass/sectors-live.log`
     Expected: `5 organizations in 1 lane(s), LLM online (google)` and `5 organizations: 5 passed, 0 failed`, with Gemini's differences listed. A problem line (not finished, a failed stage, a leaked tool name) is a finding. If our code mishandles an answer shape (a crash, a leaked thought, a tool call run twice), fix it with a test as in Task 2 Step 6. If it is Gemini's judgement or tool use (a wrong tool, an endless step), add one line to `docs/known-gaps.md` under a new "With Gemini" heading, and ledger it.
- **An Anthropic key:** the same as above without the model check and `--rpm`: restart `pnpm dev`, then `pnpm evals:live` (all types) and `pnpm e2e:sectors`.

Leave `pnpm dev` running with the key; the user chose to set it.

- [ ] **Step 3: Update the project memory**

Update `/Users/jes/.claude/projects/-Users-jes-Documents-projects-master-ai/memory/onehuman-os-build.md`: Plan 7 done, what `pnpm e2e:sectors` covers, whether the live run happened, and that the deferred lists now live in `docs/known-gaps.md` (so the memory can point there instead of repeating them).
