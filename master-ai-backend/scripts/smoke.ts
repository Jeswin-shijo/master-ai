/**
 * End-to-end check of the vertical slice against a running API + worker:
 *
 *   signup (industry text) → pack preview → install → goal → plan review →
 *   agent proposes → policy → signed approval → execution → audit chain verify
 *
 * Also checks tenant isolation (RLS) and the generated pack for a second,
 * uncurated industry. Run: pnpm smoke  (API_URL defaults to localhost:3000)
 */
import { randomBytes } from 'node:crypto';
import type { SectorId } from '@onehuman/schemas';
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
  return { api, auth, draft, ws };
}

async function signedDecision(api: ApiClient, seed: string, keyId: string, approvalId: string, decision: 'approved' | 'rejected', notes?: string) {
  const signedAt = new Date().toISOString();
  const signature = signApproval(seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return api.approvals.decide(approvalId, { decision, notes, signature, keyId, signedAt });
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

  const pulse = await api.ops.pulse();
  log('Daily pulse', `${pulse.headline} | ${pulse.lines.join(' ')}`);
  console.log('\nSmoke test passed.');
}

main().catch((err) => {
  console.error('\n✗ Smoke test failed:', err instanceof ApiError ? `${err.status} ${err.message}` : err);
  process.exit(1);
});
