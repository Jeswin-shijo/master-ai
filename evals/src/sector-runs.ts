import { composeForSector, lifecycleOf, resolvePack, TOOL_CATALOG, toWireName } from '@onehuman/agent-kit';
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

/** Every tool name the organization's agents could use: the catalog's and the pack's own, as written and as the model sees them (records__update). */
export function toolNamesOf(pack: ResolvedPack): string[] {
  const names = [...TOOL_CATALOG.map((t) => t.name), ...pack.tools.map((t) => t.name)];
  return [...new Set([...names, ...names.map(toWireName)])];
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

/** Every sentence people read about the case: the report and its outcome, each stage's summary, and each approval's summary, the agent's own words on it, and its reasons. */
function wordsPeopleRead(d: CaseDetail): string[] {
  const words = [
    d.report.text,
    d.report.outcome ?? '',
    d.case.outcome ?? '',
    ...d.report.stages.map((s) => s.summary ?? ''),
    ...d.approvals.flatMap((a) => [a.summary, a.rationale ?? '', ...a.reasons]),
  ];
  return [...new Set(words)].filter((t) => t.length > 0);
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
