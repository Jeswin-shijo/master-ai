/**
 * End-to-end check of the vertical slice against a running API + worker:
 *
 *   signup (industry text) → pack preview → install → goal → plan review →
 *   agent proposes → policy → signed approval → execution → audit chain verify
 *
 * Also checks tenant isolation (RLS) and the generated pack for a second,
 * uncurated industry, then cases in every sector (8 stages, gates, sign-off,
 * report), intake form and API, needs-info, cancel, rejected gate, not
 * eligible, kill switch and RLS on cases. Run: pnpm smoke  (API_URL defaults to localhost:3000)
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ORG_TYPES, type CaseDetail, type SectorId } from '@onehuman/schemas';
import { ApiError, connectRealtime, createClient, createDeviceKey, signApproval, type ApiClient } from '@onehuman/sdk';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

function log(step: string, detail = '') {
  console.log(`✓ ${step}${detail ? `  ${detail}` : ''}`);
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function onboard(sector: SectorId, orgType: string, industry: string, companyName: string) {
  let token: string | null = null;
  const api = createClient({ baseUrl: API_URL, getToken: () => token });
  const email = `owner+${randomBytes(4).toString('hex')}@example.com`;
  const auth = await api.auth.signup({ companyName, ownerName: 'Asha Owner', email, password: 'correct horse battery', sector, orgType, industry });
  token = auth.token;
  const draft = await api.onboarding.preview();
  const ws = await api.onboarding.install({ draftId: draft.id, sampleData: true });
  return { api, auth, draft, ws, email };
}

async function signedDecision(api: ApiClient, seed: string, keyId: string, approvalId: string, decision: 'approved' | 'rejected', notes?: string) {
  const signedAt = new Date().toISOString();
  const signature = signApproval(seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return api.approvals.decide(approvalId, { decision, notes, signature, keyId, signedAt });
}

interface SuiteCase {
  id: string;
  request: string;
  amount_inr?: number;
  expect: { category: string; priority: string; review: string; approval?: { required: boolean; role?: string }; signoff?: { required: boolean; role?: string } };
}

/** A real request from an organization type's test set. */
function suiteCase(orgType: string, id: string): SuiteCase {
  const suite = parse(readFileSync(join(__dirname, '../../evals/suites', `${orgType}.yaml`), 'utf8')) as { cases: SuiteCase[] };
  const found = suite.cases.find((c) => c.id === id);
  if (!found) throw new Error(`No case ${id} in the ${orgType} test set`);
  return found;
}

const FINAL = ['closed', 'rejected', 'cancelled', 'escalated'];

/** Wait for a case to reach a state, approving gates and actions on the way when asked. */
async function driveCase(
  api: ApiClient,
  seed: string,
  keyId: string,
  caseId: string,
  until: (d: CaseDetail) => boolean,
  opts: { approve?: boolean; timeoutMs?: number } = {},
): Promise<CaseDetail> {
  return waitFor(
    `case ${caseId}`,
    async () => {
      const d = await api.cases.get(caseId);
      if (until(d)) return d;
      if (opts.approve) {
        const pending = (await api.approvals.list()).filter((a) => a.caseId === caseId || (d.case.goalId && a.goalId === d.case.goalId));
        for (const a of pending) await signedDecision(api, seed, keyId, a.id, 'approved', 'Checked by the smoke test');
      }
      return null;
    },
    opts.timeoutMs ?? 240_000,
  );
}

async function expectStatus(promise: Promise<unknown>, status: number, what: string) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === status) return log(what, `${err.status} ${err.message}`);
    throw err;
  }
  throw new Error(`${what}: expected ${status}, got success`);
}

const SECTOR_RUNS: { sector: SectorId; orgType: string; caseId: string; entry: 'app' | 'form' | 'api' }[] = [
  { sector: 'energy-heavy-industry', orgType: 'power-plant', caseId: 'fan-bearings', entry: 'app' },
  { sector: 'trade-logistics-tourism', orgType: 'travel-agency', caseId: 'school-trip-deposit', entry: 'app' },
  { sector: 'finance-development', orgType: 'lender', caseId: 'personal-loan-wedding', entry: 'form' },
  { sector: 'technology-innovation', orgType: 'it-services', caseId: 'owner-says-skip-cab', entry: 'app' },
  { sector: 'public-services', orgType: 'hospital', caseId: 'discharge-final-approval', entry: 'api' },
];

/** One organization per sector: signup → 8 named stages → a real request runs every stage → report. */
async function sectorRun(run: (typeof SECTOR_RUNS)[number]) {
  const name = ORG_TYPES.find((t) => t.id === run.orgType)!.name;
  const org = await onboard(run.sector, run.orgType, name, `Smoke ${name}`);
  const { api } = org;
  const lc = org.ws.pack.lifecycle;
  if (!lc) throw new Error(`${run.orgType}: installed without a lifecycle`);
  log(`${name}: installed`, `${lc.case.plural} · ${lc.stages.map((s) => s.name).join(' → ')}`);
  await api.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
  const key = createDeviceKey(new Uint8Array(randomBytes(32)));
  const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: 'smoke-test', platform: 'web' });

  const c = suiteCase(run.orgType, run.caseId);
  const tenantId = org.auth.tenant.id;
  let caseId: string;
  if (run.entry === 'app') {
    caseId = (await api.cases.create({ text: c.request, ...(c.amount_inr && { amountInr: c.amount_inr }) })).id;
  } else if (run.entry === 'form') {
    const form = await api.intakeKeys.create({ kind: 'form', label: 'Website' });
    const sent = await api.intake.submitForm(tenantId, form.key, { name: 'Lakshmi', phone: '9876543210', text: c.request });
    caseId = (await api.cases.list('all')).find((x) => x.code === sent.code)!.id;
    log(`${name}: request through the public form`, sent.code);
  } else {
    const intake = await api.intakeKeys.create({ kind: 'api', label: 'Hospital system', source: 'system' });
    const body = { text: c.request, requester: { name: 'Hospital information system' }, externalRef: `smoke-${run.caseId}`, ...(c.amount_inr && { amountInr: c.amount_inr }) };
    const [a, b] = await Promise.all([api.intake.submit(tenantId, intake.key, body), api.intake.submit(tenantId, intake.key, body)]);
    if (a.caseId !== b.caseId || a.duplicate === b.duplicate) throw new Error(`intake not idempotent: ${JSON.stringify([a, b])}`);
    log(`${name}: intake API is idempotent`, `two posts → ${a.code}`);
    await expectStatus(api.intake.submit(tenantId, 'ohk_not-a-real-key', body), 401, `${name}: a bad intake key is refused`);
    caseId = a.caseId;
  }

  // The gate goes to the owner while nobody holds the rule's role, and says so.
  const atGate = await driveCase(api, key.seed, device.id, caseId, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  const gate = atGate.approvals.find((a) => a.status === 'pending' && a.stage === 'approve')!;
  const role = c.expect.approval?.role ?? 'owner';
  if (gate.approver !== 'owner' || (role !== 'owner' && !gate.reasons.some((r) => r.includes('Nobody holds')))) {
    throw new Error(`${name}: gate routed to ${gate.approver} with reasons ${gate.reasons.join('; ')}`);
  }
  log(`${name}: ${atGate.case.code} waits at ${lc.stages[4]!.name}`, `${gate.summary} | ${gate.reasons.join(' ')}`);

  const done = await driveCase(api, key.seed, device.id, caseId, (d) => FINAL.includes(d.case.status) && d.report.stages[7]!.status === 'done', { approve: true });
  if (done.case.status !== 'closed') throw new Error(`${name}: ${done.case.code} ended ${done.case.status}: ${done.case.outcome}`);
  const names = done.report.stages.map((s) => s.name);
  if (names.join('|') !== lc.stages.map((s) => s.name).join('|')) throw new Error(`${name}: stage names ${names.join(', ')}`);
  if (c.expect.signoff?.required && !done.approvals.some((a) => a.stage === 'close' && a.status === 'approved')) {
    throw new Error(`${name}: expected a sign-off`);
  }
  log(`${name}: ${done.case.code} closed`, done.report.text);
  for (const s of done.report.stages) console.log(`    · ${s.name.padEnd(36)} ${s.status.padEnd(8)} ${s.summary ?? ''}`);
  return { org, key, device };
}

/** needs-info, cancel while waiting, a rejected gate, not eligible, the kill switch and RLS. */
async function caseChecks(power: Awaited<ReturnType<typeof sectorRun>>, lender: Awaited<ReturnType<typeof sectorRun>>, hospitalApi: ApiClient) {
  const { api } = power.org;
  const seed = power.key.seed;
  const keyId = power.device.id;

  // Needs info: waits, then runs on once the detail arrives.
  const paperwork = await api.cases.create({ text: suiteCase('power-plant', 'new-connection-one-paper').request });
  await driveCase(api, seed, keyId, paperwork.id, (d) => d.case.status === 'needs_info');
  log('Needs info: the case waits', (await api.cases.get(paperwork.id)).report.stages[1]!.summary ?? '');
  await api.cases.addInfo(paperwork.id, { text: 'Attaching the property tax receipt of the house as ownership proof.' });
  const moved = await driveCase(api, seed, keyId, paperwork.id, (d) => d.report.stages[1]!.status === 'done');
  log('Needs info: review passed after the details came', moved.report.stages[1]!.summary ?? '');
  // Tidy up: it may already have finished on its own.
  await api.cases.cancel(paperwork.id, { reason: 'Smoke test tidy-up' }).catch((err: unknown) => {
    if (!(err instanceof ApiError && err.status === 409)) throw err;
  });
  await driveCase(api, seed, keyId, paperwork.id, (d) => FINAL.includes(d.case.status) && d.report.stages[7]!.status === 'done');

  // Cancel while waiting on the gate: the approval leaves the inbox and the case is still reported.
  const welding = await api.cases.create({ text: suiteCase('power-plant', 'contractor-welding').request });
  const waiting = await driveCase(api, seed, keyId, welding.id, (d) => d.approvals.some((a) => a.status === 'pending'));
  const gateId = waiting.approvals.find((a) => a.status === 'pending')!.id;
  await api.cases.cancel(welding.id, { reason: 'Contractor postponed' });
  const cancelled = await driveCase(api, seed, keyId, welding.id, (d) => d.case.status === 'cancelled' && d.report.stages[7]!.status === 'done');
  if ((await api.approvals.get(gateId)).status !== 'expired') throw new Error('the cancelled case left its approval pending');
  log('Cancel while waiting: approval withdrawn, case reported', cancelled.report.text);

  // Not eligible: ends at review with the reason.
  const wiring = await api.cases.create({ text: suiteCase('power-plant', 'one-room-dark').request });
  const refused = await driveCase(api, seed, keyId, wiring.id, (d) => FINAL.includes(d.case.status) && d.report.stages[7]!.status === 'done');
  if (refused.case.status !== 'rejected' || !refused.case.outcome?.startsWith('Not eligible')) throw new Error(`not eligible ended ${refused.case.status}: ${refused.case.outcome}`);
  log('Not eligible: closed at review', refused.case.outcome);

  // A rejected gate ends the case with the approver's note.
  const lapi = lender.org.api;
  const refund = await lapi.cases.create({ text: suiteCase('lender', 'double-debit-refund').request, amountInr: 38_500 });
  const atGate = await driveCase(lapi, lender.key.seed, lender.device.id, refund.id, (d) => d.approvals.some((a) => a.status === 'pending'));
  await signedDecision(lapi, lender.key.seed, lender.device.id, atGate.approvals.find((a) => a.status === 'pending')!.id, 'rejected', 'The bank already reversed the second debit');
  const rejected = await driveCase(lapi, lender.key.seed, lender.device.id, refund.id, (d) => FINAL.includes(d.case.status) && d.report.stages[7]!.status === 'done');
  if (rejected.case.status !== 'rejected' || !rejected.case.outcome?.includes('already reversed')) throw new Error(`rejected gate ended ${rejected.case.status}: ${rejected.case.outcome}`);
  log('Rejected gate: case closed with the note', rejected.case.outcome);

  // Kill switch: new cases are refused, and an approved case waits before its work starts.
  const bearings = await api.cases.create({ text: suiteCase('power-plant', 'fan-bearings').request, amountInr: 380_000 });
  const bearingsGate = await driveCase(api, seed, keyId, bearings.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  const lobby = await api.intakeKeys.create({ kind: 'form', label: 'Consumer form' });
  await api.tenant.pause();
  await expectStatus(api.cases.create({ text: 'Lube oil top-up for ID fan 2B' }), 409, 'Kill switch refuses new cases');
  // Requests from outside are kept while paused; they wait at stage 1 until resume.
  const queued = await api.intake.submitForm(power.org.auth.tenant.id, lobby.key, { name: 'Ramesh', phone: '9846001122', text: 'Street light pole 14 in Sector 4 is sparking after the rain' });
  const queuedId = (await api.cases.list('all')).find((x) => x.code === queued.code)!.id;
  log('Kill switch keeps a customer request waiting', queued.code);
  await signedDecision(api, seed, keyId, bearingsGate.approvals.find((a) => a.status === 'pending')!.id, 'approved', 'Quotes checked');
  await new Promise((r) => setTimeout(r, 4000));
  const held = await api.cases.get(bearings.id);
  if (held.case.stage !== 'execute' || held.case.goalId) throw new Error(`kill switch did not hold the work: stage ${held.case.stage}, goal ${held.case.goalId}`);
  log('Kill switch holds an approved case before its work');
  await api.tenant.resume();
  await driveCase(api, seed, keyId, queuedId, (d) => d.report.stages[1]!.status !== 'pending');
  log('The waiting request moved on after resume');
  await driveCase(api, seed, keyId, bearings.id, (d) => FINAL.includes(d.case.status) && d.report.stages[7]!.status === 'done', { approve: true });
  log('Resumed case finished', (await api.cases.get(bearings.id)).case.status);

  // RLS: another company cannot see these cases.
  await expectStatus(hospitalApi.cases.get(bearings.id), 404, 'Tenant isolation holds for cases (RLS)');

  const verify = await api.audit.verify();
  if (!verify.ok) throw new Error('audit chain broken after the case checks');
  log('Audit chain verified after the case checks', `${verify.checked} events`);
}

/** Invites, approver roles, the mine inbox, owner/admin routes and removal. */
async function roleChecks(otherCompanyOwner: { email: string }) {
  const plant = await onboard('energy-heavy-industry', 'power-plant', 'Power plant & utilities', 'Smoke Roles Plant');
  const owner = plant.api;
  const tenantId = plant.auth.tenant.id;
  await owner.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
  const ownerKey = createDeviceKey(new Uint8Array(randomBytes(32)));
  const ownerDevice = await owner.auth.registerDeviceKey({ publicKey: ownerKey.publicKey, label: 'smoke-owner', platform: 'web' });

  await expectStatus(owner.invites.create({ name: 'Wizard', email: `wizard+${randomBytes(3).toString('hex')}@example.com`, approverRoles: ['chief-wizard'] }), 400, 'An unknown approval role is refused');

  const join = async (
    name: string,
    approverRoles: string[],
    email = `${name.toLowerCase()}+${randomBytes(3).toString('hex')}@example.com`,
    password = 'correct horse battery',
    role: 'admin' | 'member' = 'member',
  ) => {
    const inv = await owner.invites.create({ name, email, approverRoles, role });
    const view = await owner.invites.view(tenantId, inv.path.split('/').pop()!);
    const auth = await owner.invites.accept(tenantId, inv.path.split('/').pop()!, { password });
    let token: string | null = auth.token;
    const api = createClient({ baseUrl: API_URL, getToken: () => token });
    const key = createDeviceKey(new Uint8Array(randomBytes(32)));
    const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: `smoke-${name}`, platform: 'web' });
    return { api, auth, key, device, inv, view, signOut: () => (token = null) };
  };
  const sunita = await join('Sunita', ['safety-officer']);
  const manoj = await join('Manoj', []);
  log('Invites accepted', `${sunita.view.companyName}: Sunita (${sunita.view.approverRoles.map((r) => r.name).join(', ')}), Manoj (member)`);

  // The same link twice, and a withdrawn link, are refused.
  await expectStatus(owner.invites.accept(tenantId, sunita.inv.path.split('/').pop()!, { password: 'correct horse battery' }), 404, 'An invite works once');
  const spare = await owner.invites.create({ name: 'Spare', email: `spare+${randomBytes(3).toString('hex')}@example.com` });
  await owner.invites.revoke(spare.id);
  await expectStatus(owner.invites.view(tenantId, spare.path.split('/').pop()!), 404, 'A withdrawn invite is refused');

  // An owner of another company joins this one with their own password; a wrong one creates nothing.
  const guestInv = await owner.invites.create({ name: 'Guest', email: otherCompanyOwner.email });
  const guestToken = guestInv.path.split('/').pop()!;
  if (!(await owner.invites.view(tenantId, guestToken)).hasAccount) throw new Error('existing login not recognised');
  await expectStatus(owner.invites.accept(tenantId, guestToken, { password: 'not the password' }), 401, 'A wrong password on an existing login is refused');
  const guestAuth = await owner.invites.accept(tenantId, guestToken, { password: 'correct horse battery' });
  if (guestAuth.tenant.id !== tenantId) throw new Error('existing login did not join the second company');
  log('Someone with a login joined a second company with their own password');

  // Later they sign in again: both companies are offered, and they switch to the new one.
  const again = await createClient({ baseUrl: API_URL }).auth.login({ email: otherCompanyOwner.email, password: 'correct horse battery' });
  if (!again.companies.some((co) => co.id === tenantId)) throw new Error('second company missing at sign-in');
  let guestSession: string | null = again.token;
  const guestApi = createClient({ baseUrl: API_URL, getToken: () => guestSession });
  const phone = `ExponentPushToken[smoke-${randomBytes(4).toString('hex')}]`;
  await guestApi.auth.registerPushToken({ token: phone, platform: 'android' });
  guestSession = (await guestApi.auth.switchCompany(tenantId)).token;
  await guestApi.cases.list();
  await guestApi.auth.registerPushToken({ token: phone, platform: 'android' });
  log('Signed in again and switched company; one phone gets pushes from both', again.companies.map((co) => co.name).join(', '));

  // An admin's open invites die with the admin's access; admins can't touch the owner; demotion applies at once.
  const owners = (await owner.members.list()).filter((m) => m.role === 'owner');
  const arjun = await join('Arjun', [], undefined, undefined, 'admin');
  const shadow = await arjun.api.invites.create({ name: 'Shadow', email: `shadow+${randomBytes(3).toString('hex')}@example.com`, role: 'admin', approverRoles: ['safety-officer'] });
  await expectStatus(arjun.api.members.update(owners[0]!.id, { approverRoles: [] }), 403, 'An admin cannot change the owner');
  await owner.members.remove(arjun.auth.user.principalId);
  await expectStatus(owner.invites.accept(tenantId, shadow.path.split('/').pop()!, { password: 'correct horse battery' }), 404, 'An invite from a removed admin no longer works');
  const priya = await join('Priya', [], undefined, undefined, 'admin');
  await priya.api.tenant.updateSettings({ redactPii: true });
  await owner.members.update(priya.auth.user.principalId, { role: 'member' });
  await expectStatus(priya.api.tenant.updateSettings({ redactPii: true }), 403, 'A demoted admin loses settings at once');

  // A team-directory record links to a login on its own (one person takes calls and approves).
  const staffRecord = (await owner.team.list())[0]!;
  const linked = await owner.members.update(sunita.auth.user.principalId, { staffId: staffRecord.id });
  if (linked.staffId !== staffRecord.id) throw new Error('staff link not saved');
  log('Linked a team-directory record to a login', `${staffRecord.name} → Sunita`);

  const template = (await owner.routines.templates())[0];
  if (template) await expectStatus(manoj.api.routines.create({ templateId: template.id }), 403, 'A member cannot set up routines that phone staff');

  // A hot-work case: the gate goes to the safety officer, not the owner.
  const c = await owner.cases.create({ text: suiteCase('power-plant', 'contractor-welding').request });
  const atGate = await driveCase(owner, ownerKey.seed, ownerDevice.id, c.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  const gate = atGate.approvals.find((a) => a.status === 'pending' && a.stage === 'approve')!;
  if (gate.approver !== 'safety-officer') throw new Error(`gate routed to ${gate.approver}`);
  log('Gate routed to the role holder', gate.summary);

  const manojInbox = await manoj.api.approvals.list('pending', { mine: true });
  const sunitaInbox = await sunita.api.approvals.list('pending', { mine: true });
  if (manojInbox.some((a) => a.id === gate.id) || !sunitaInbox.some((a) => a.id === gate.id)) throw new Error('mine inbox lists the wrong approvals');
  log('Mine inbox', `Sunita ${sunitaInbox.length}, Manoj ${manojInbox.length}`);
  const [manojPulse, sunitaPulse] = await Promise.all([manoj.api.ops.pulse(), sunita.api.ops.pulse()]);
  if (manojPulse.pendingApprovals !== 0 || sunitaPulse.pendingApprovals < 1) throw new Error(`pulse counts: Manoj ${manojPulse.pendingApprovals}, Sunita ${sunitaPulse.pendingApprovals}`);
  log('The pulse counts only your own decisions', `Sunita: ${sunitaPulse.headline}; Manoj: ${manojPulse.headline}`);
  await expectStatus(signedDecision(manoj.api, manoj.key.seed, manoj.device.id, gate.id, 'approved'), 403, 'A person without the role is refused');
  await signedDecision(sunita.api, sunita.key.seed, sunita.device.id, gate.id, 'approved', 'Permit HW-118 issued, area checked');
  log('The safety officer approved the gate');

  // The rest of the case (actions, sign-off) is approved by the owner, who may decide anything.
  const done = await driveCase(owner, ownerKey.seed, ownerDevice.id, c.id, (d) => ['closed', 'rejected', 'cancelled', 'escalated'].includes(d.case.status) && d.report.stages[7]!.status === 'done', { approve: true });
  log('Role-approved case finished', `${done.case.code} ${done.case.status}`);

  // Members can't change settings or the team; removal ends access at once.
  await expectStatus(manoj.api.tenant.updateSettings({ redactPii: false }), 403, 'A member cannot change settings');
  await expectStatus(manoj.api.members.update(sunita.auth.user.principalId, { approverRoles: [] }), 403, 'A member cannot change the team');
  await expectStatus(sunita.api.members.update(owners[0]!.id, { approverRoles: ['safety-officer'] }), 403, 'Nobody else changes the owner');
  await owner.members.remove(manoj.auth.user.principalId);
  await expectStatus(manoj.api.cases.list(), 401, 'A removed person is turned away at once');
}

async function main() {
  const health = await fetch(`${API_URL}/health`).then((r) => r.json());
  log('API healthy', JSON.stringify(health));

  // 1. Curated industry: the owner's text matches the travel-agency pack.
  const travel = await onboard('trade-logistics-tourism', 'travel-agency', 'Tours and travels agency in Kochi', 'Kerala Trails');
  log('Signed up + onboarded', `${travel.draft.generator}: ${travel.draft.rationale}`);
  log('Workspace installed', `${travel.ws.pack.name} v${travel.ws.pack.version} (${travel.ws.pack.lineage.join(' → ')}), ${travel.ws.pack.agents.length} agents`);

  const { api } = travel;
  const liveEvents: string[] = [];
  let liveOpen = false;
  const live = connectRealtime({
    baseUrl: API_URL,
    token: travel.auth.token,
    onEvent: (e) => liveEvents.push(e.type),
    onStatus: (s) => (liveOpen ||= s === 'open'),
  });
  await waitFor('realtime connection', async () => liveOpen, 10_000);
  const key = createDeviceKey(new Uint8Array(randomBytes(32)));
  const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: 'smoke-test', platform: 'web' });
  log('Device key registered', device.id);

  // 2. Goal → plan → owner approves plan.
  const goal = await api.goals.create({ text: 'Refund ₹12,000 to Asha Menon because her Munnar trip was cancelled' });
  const planned = await waitFor('plan', async () => {
    const d = await api.goals.get(goal.id);
    return d.goal.status === 'awaiting_plan_approval' && d;
  });
  log('Plan ready', `${planned.goal.plan?.rationale} → ${planned.tasks.map((t) => `${t.title} [${t.agentRole}]`).join(', ')}`);
  await api.goals.decidePlan(goal.id, { approved: true });
  log('Plan approved by owner');

  // 3. Agent proposes the refund; policy says Level 4; owner approves with a signed decision.
  const approval = await waitFor('approval request', async () => (await api.approvals.list()).find((a) => a.goalId === goal.id));
  log('Approval requested', `${approval.summary} | risk ${approval.riskScore} | ${approval.reasons.join('; ')}`);

  // A bad signature must be refused.
  try {
    await api.approvals.decide(approval.id, { decision: 'approved', signature: 'AAAA', keyId: device.id, signedAt: new Date().toISOString() });
    throw new Error('forged signature was accepted');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 403) throw err;
    log('Forged signature rejected', `${err.status} ${err.message}`);
  }

  const decided = await signedDecision(api, key.seed, device.id, approval.id, 'approved', 'Cancellation confirmed by supplier');
  log('Approved with device signature', decided.status);

  const done = await waitFor('goal to finish', async () => {
    const d = await api.goals.get(goal.id);
    return ['completed', 'partially_completed', 'failed', 'cancelled'].includes(d.goal.status) && d;
  });
  log('Goal finished', `${done.goal.status}\n    ${done.goal.summary?.split('\n').join('\n    ')}`);
  for (const c of done.toolCalls) {
    console.log(`    · ${c.tool.padEnd(18)} L${c.decision?.level ?? '-'}  ${c.status}`);
  }
  const refund = done.toolCalls.find((c) => c.tool === 'refund.issue');
  if (refund?.status !== 'executed') throw new Error('refund was not executed after approval');
  const outbox = await api.records.outbox();
  log('Sandbox connector recorded the refund', JSON.stringify(outbox.find((o) => o.kind === 'refund')?.payload));

  live.close();
  if (!liveEvents.includes('approval.requested') || !liveEvents.includes('goal.completed')) {
    throw new Error(`realtime stream missed events: ${liveEvents.join(', ')}`);
  }
  log('Realtime stream delivered events', `${liveEvents.length} events over WebSocket`);

  // 4. Audit chain is intact.
  const verify = await api.audit.verify();
  if (!verify.ok) throw new Error(`audit chain broken at ${verify.firstBrokenSeq}`);
  log('Audit chain verified', `${verify.checked} events, head ${verify.headHash.slice(0, 12)}…`);

  // 4b. Work done by the team over the phone: assign → follow up → confirm (simulated staff answer).
  await api.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
  const team = await api.team.list();
  log('Team directory', team.map((p) => `${p.name} (${p.title})`).join(', '));
  const job = await api.goals.create({ text: 'Make sure the Munnar hotel rooms are inspected before the group arrives', autoStart: true });
  const jobDone = await waitFor(
    'delegated goal to finish',
    async () => {
      const d = await api.goals.get(job.id);
      return ['completed', 'partially_completed', 'failed'].includes(d.goal.status) && d;
    },
    120_000,
  );
  const [delegation] = await api.delegations.list(job.id);
  if (!delegation || delegation.status !== 'done') throw new Error(`delegation ended as ${delegation?.status}`);
  log('Delegated by phone', `${delegation.staffName} (${delegation.staffTitle}) → ${delegation.status}, ${delegation.calls.length} calls`);
  for (const c of delegation.calls) console.log(`    · call ${c.stage.padEnd(9)} ${c.outcome?.padEnd(9)} ${c.summary}`);
  if (delegation.calls.map((c) => c.stage).join(',') !== 'assign,follow_up,confirm') throw new Error('expected assign, follow-up and confirm calls');
  log('Goal finished', `${jobDone.goal.status}: ${jobDone.goal.summary}`);
  const finalVerify = await api.audit.verify();
  if (!finalVerify.ok) throw new Error('audit chain broken after calls');

  // 4c. Routines: a daily check-in collected by phone (simulated staff answer every question).
  const templates = await api.routines.templates();
  const checkin = await api.routines.create({ templateId: templates.find((t) => t.id === 'daily-bookings-check')?.id ?? templates[0]!.id });
  await api.routines.run(checkin.id);
  const checked = await waitFor(
    'check-in calls to finish',
    async () => {
      const day = await api.routines.day(checkin.id);
      return day.summary.reported + day.summary.missed === day.summary.expected && day;
    },
    120_000,
  );
  if (checked.summary.reported !== checked.summary.expected) throw new Error(`only ${checked.summary.reported} of ${checked.summary.expected} reported`);
  log('Routine check-in by phone', `${checkin.name}: ${checked.summary.reported}/${checked.summary.expected} reported, ${checked.summary.flags.length} problem(s) flagged`);
  for (const e of checked.entries) console.log(`    · ${e.staffName.padEnd(14)} ${JSON.stringify(e.values)}`);
  // Leave no daily schedule behind for the test company.
  await api.routines.update(checkin.id, { status: 'paused' });

  // 5. An industry with no curated pack is composed/generated and adapted.
  const clinic = await onboard('public-services', 'Dental clinic in Kochi', 'Dental clinic in Kochi', 'Smile Dental');
  const labels = clinic.ws.pack.entities.map((e) => e.label).join(', ');
  log('Generated pack for dental clinic', `${clinic.draft.generator}: ${clinic.ws.pack.name} | entities: ${labels}`);

  // 6. Tenant isolation: the clinic cannot see the travel agency's goal.
  try {
    await clinic.api.goals.get(goal.id);
    throw new Error('cross-tenant read succeeded');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    log('Tenant isolation holds (RLS)', `clinic → travel goal: ${err.status}`);
  }

  // 7. Kill switch blocks new goals.
  await clinic.api.tenant.pause();
  try {
    await clinic.api.goals.create({ text: 'Follow up on overdue enquiries' });
    throw new Error('goal accepted while paused');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
    log('Kill switch refuses new goals', err.message);
  }
  await clinic.api.tenant.resume();

  // 8. Cases: one organization per sector, then the edge checks.
  const runs = [];
  for (const run of SECTOR_RUNS) runs.push(await sectorRun(run));
  await caseChecks(runs[0]!, runs[2]!, runs[4]!.org.api);
  // 9. Roles and invites: role holders approve, others can't.
  await roleChecks({ email: runs[0]!.org.email });

  const pulse = await api.ops.pulse();
  log('Daily pulse', `${pulse.headline} | ${pulse.lines.join(' ')}`);
  console.log('\nSmoke test passed.');
}

main().catch((err) => {
  console.error('\n✗ Smoke test failed:', err instanceof ApiError ? `${err.status} ${err.message}` : err);
  process.exit(1);
});
