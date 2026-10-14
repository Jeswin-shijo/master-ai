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
// A real model is slow, and LLM_MAX_RPM may space its calls out, so live cases get longer.
const TIMEOUT_MS = LIVE ? 1_200_000 : 300_000;
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
    // Every approval must first be refused to the member; a case that never reached a gate (a live model judged it not eligible) has none.
    if (d.approvals.some((a) => a.kind === 'case_gate') && !memberRefused) result.problems.push('an approval went ahead without first being refused to someone without the role');
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
