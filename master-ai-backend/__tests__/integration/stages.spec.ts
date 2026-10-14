import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { caseReportText, caseReportView, createDeviceKey, signApproval, type DeviceKeyPair } from '@onehuman/sdk';
import type { StageKey } from '@onehuman/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { AuditService } from '../../src/audit/audit.service';
import { CasesService } from '../../src/cases/cases.service';
import { CaseStagesService } from '../../src/cases/stages.service';
import type { Session } from '../../src/common/auth';
import { IdentityService } from '../../src/identity/identity.service';
import { MembersService } from '../../src/members/members.service';
import type { CaseEnding, GateName } from '../../src/orchestration/shared';
import { anyIp, boot, newOrg, PASSWORD, uniqueEmail, type Harness, type Org } from './harness';

/**
 * The stage service on its own: each test calls the stage activities in the
 * order the case workflow does (orchestration/case-workflows.ts), on a real
 * database, with the built-in rules standing in for the model.
 */

const WELDING =
  'M/s Shree Fabricators: we will start welding of chute liner plates at Conveyor 3B transfer house tomorrow 10 am, 4 welders and 1 helper. Please arrange hot work permit.';

let h: Harness;
let stages: CaseStagesService;
let cases: CasesService;
let plant: Org;
let officer: Session;
let member: Session;

beforeAll(async () => {
  h = await boot();
  stages = h.get(CaseStagesService);
  cases = h.get(CasesService);
  plant = await newOrg(h, 'power-plant');
  officer = await join(plant, 'Sunita Safety', ['safety-officer']);
  member = await join(plant, 'Manoj Member', []);
});
afterAll(() => h.close());

async function join(org: Org, name: string, approverRoles: string[]): Promise<Session> {
  const members = h.get(MembersService);
  const made = await members.invite(org.session, { name, email: uniqueEmail('person'), role: 'member', approverRoles });
  const auth = await members.accept(org.tenantId, made.path.split('/').pop()!, { password: PASSWORD }, anyIp());
  return { userId: auth.user.userId, principalId: auth.user.principalId, tenantId: org.tenantId, role: 'member' };
}

const keys = new Map<string, { id: string; pair: DeviceKeyPair }>();
/** Decide as this person, signed with their device key, as the apps do. */
async function decide(who: Session, approvalId: string, decision: 'approved' | 'rejected', notes?: string) {
  let key = keys.get(who.principalId);
  if (!key) {
    const pair = createDeviceKey(new Uint8Array(randomBytes(32)));
    const registered = await h.get(IdentityService).registerDeviceKey(who, { publicKey: pair.publicKey, label: 'spec', platform: 'web' });
    key = { id: registered.id, pair };
    keys.set(who.principalId, key);
  }
  const signedAt = new Date().toISOString();
  const signature = signApproval(key.pair.seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return h.get(ApprovalsService).decide(who, approvalId, { decision, notes, keyId: key.id, signedAt, signature });
}

/** One case, driven through its stages by hand. */
function driver(org: Org, caseId: string) {
  const at = (stage: StageKey, attempt = 1) => ({ tenantId: org.tenantId, caseId, stage, attempt });
  return {
    at,
    async run(stage: StageKey) {
      await stages.beginStage(at(stage));
      return stages.runStage(at(stage));
    },
    async gate(stage: 'approve' | 'close', gate: GateName) {
      if (stage === 'approve') await stages.beginStage(at(stage));
      return stages.openGate({ ...at(stage), gate });
    },
    close: (stage: 'approve' | 'close', gate: GateName, approvalId: string, decision: 'approved' | 'rejected' | 'expired', notes?: string) =>
      stages.closeGate({ ...at(stage), gate, approvalId, decision, ...(notes && { notes }) }),
    async finish(ending: CaseEnding, reason: string | null = null) {
      await stages.finishCase({ tenantId: org.tenantId, caseId, ending, reason });
      await stages.beginStage(at('report'));
      return stages.runStage(at('report'));
    },
    detail: () => cases.detail(org.tenantId, caseId),
  };
}

async function upToApproval(org: Org, text = WELDING) {
  const c = await cases.create(org.session, { text });
  const d = driver(org, c.id);
  for (const stage of ['request', 'review', 'classify', 'assign'] as const) expect(await d.run(stage), stage).toEqual({ outcome: 'done' });
  return { c, d };
}

describe('a hot-work job, stage by stage', () => {
  it('runs all 8 stages: the safety officer approves the permit and signs off, and the job closes with its report', async () => {
    const { c, d } = await upToApproval(plant);
    expect(h.temporal.some((t) => t.method === 'startCase' && (t.args[0] as { caseId: string }).caseId === c.id)).toBe(true);
    const classified = await d.detail();
    expect(classified.case).toMatchObject({ code: c.code, stage: 'assign' });
    expect(classified.case.categoryName).toBeTruthy();
    expect(classified.case.priority).toMatch(/^P[1-4]$/);

    // Stage 5: the permit waits for the role that holds it.
    const permit = await d.gate('approve', 'proceed');
    expect(permit.status).toBe('waiting');
    const approvalId = (permit as { approvalId: string }).approvalId;
    expect((await d.detail()).case.status).toBe('waiting_approval');
    const approval = (await d.detail()).approvals.find((a) => a.id === approvalId)!;
    expect(approval).toMatchObject({ kind: 'case_gate', stage: 'approve', approver: 'safety-officer', status: 'pending' });

    await expect(decide(member, approvalId, 'approved')).rejects.toBeInstanceOf(ForbiddenException);
    await decide(officer, approvalId, 'approved', 'Permit HW-118 issued');
    const signal = h.temporal.find((t) => t.method === 'deliverGateDecision' && JSON.stringify(t.args).includes(approvalId));
    expect(signal, 'the decision is sent to the waiting stage').toBeTruthy();
    await d.close('approve', 'proceed', approvalId, 'approved', 'Permit HW-118 issued');
    const approved = await d.detail();
    expect(approved.file.approve).toMatchObject({ required: true, decision: 'approved', decidedBy: 'Sunita Safety', notes: 'Permit HW-118 issued' });

    // Stage 6: the work. Its goal names the job, and the agents' instructions stay in the goal text.
    await stages.beginStage(d.at('execute'));
    const work = await stages.startExecution(d.at('execute'));
    const { rows } = await h.owner.query<{ text: string; case_id: string }>(`select text, case_id from goals where id = $1`, [work.goalId]);
    expect(rows[0]!.case_id).toBe(c.id);
    expect(rows[0]!.text.split('\n')[0]).toBe(`${c.code} · ${c.title}`);
    await h.owner.query(`update goals set status = 'completed', summary = 'Permit checked, area cleared, welding done.' where id = $1`, [work.goalId]);
    await stages.finishExecution({ ...d.at('execute'), goalId: work.goalId });
    expect((await d.detail()).file.execute).toMatchObject({ goalId: work.goalId, status: 'completed' });

    // Stage 7: verified, then the sign-off.
    await stages.beginStage(d.at('close'));
    expect(await stages.verifyClose(d.at('close'))).toEqual({ verified: true });
    const signoff = await d.gate('close', 'close');
    expect(signoff.status).toBe('waiting');
    const signoffId = (signoff as { approvalId: string }).approvalId;
    expect((await d.detail()).case.status).toBe('waiting_signoff');
    await decide(officer, signoffId, 'approved');
    await d.close('close', 'close', signoffId, 'approved');

    // Stage 8: closed, with a report people can read.
    expect(await d.finish('closed')).toEqual({ outcome: 'done' });
    const done = await d.detail();
    expect(done.case).toMatchObject({ status: 'closed', stage: 'report' });
    expect(done.case.closedAt).toBeTruthy();
    expect(done.case.outcome).toMatch(/^Resolved/);
    expect(done.report.stages.map((s) => s.stage)).toEqual(['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report']);
    expect(done.report.stages.every((s) => s.status === 'done' || s.status === 'skipped')).toBe(true);
    // The report people read and copy names the job, never an id.
    const text = caseReportText(caseReportView(done));
    expect(text).toContain(`${c.code} · ${c.title}`);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    expect((await h.get(AuditService).verify(plant.tenantId)).ok).toBe(true);
  });

  it('ends the job when the permit is refused, and skips the stages it never reached', async () => {
    const { d } = await upToApproval(plant);
    const permit = await d.gate('approve', 'proceed');
    const approvalId = (permit as { approvalId: string }).approvalId;
    await decide(officer, approvalId, 'rejected', 'Gas test not done');
    await d.close('approve', 'proceed', approvalId, 'rejected', 'Gas test not done');
    expect((await d.detail()).file.approve).toMatchObject({ decision: 'rejected' });

    await d.finish('rejected', 'Not approved: Gas test not done');
    const ended = await d.detail();
    expect(ended.case).toMatchObject({ status: 'rejected', outcome: 'Not approved: Gas test not done' });
    const byStage = Object.fromEntries(ended.report.stages.map((s) => [s.stage, s.status]));
    expect(byStage).toMatchObject({ execute: 'skipped', close: 'skipped' });
  });

  it('expires a decision nobody made, and takes it out of the inbox', async () => {
    const { d } = await upToApproval(plant);
    const permit = await d.gate('approve', 'proceed');
    const approvalId = (permit as { approvalId: string }).approvalId;
    await d.close('approve', 'proceed', approvalId, 'expired');
    const after = await d.detail();
    expect(after.approvals.find((a) => a.id === approvalId)?.status).toBe('expired');
    expect(after.file.approve).toMatchObject({ decision: 'expired' });
  });

  it('says plainly when the work stops before it finishes, and closes what it left open', async () => {
    const { c, d } = await upToApproval(plant);
    const permit = await d.gate('approve', 'proceed');
    const approvalId = (permit as { approvalId: string }).approvalId;
    await decide(officer, approvalId, 'approved');
    await d.close('approve', 'proceed', approvalId, 'approved');
    await stages.beginStage(d.at('execute'));
    const work = await stages.startExecution(d.at('execute'));
    await h.owner.query(`update goals set status = 'running' where id = $1`, [work.goalId]);

    await stages.finishExecution({ ...d.at('execute'), goalId: work.goalId, failed: true });
    const { rows } = await h.owner.query<{ status: string }>(`select status from goals where id = $1`, [work.goalId]);
    expect(rows[0]!.status).toBe('failed');
    const failed = await d.detail();
    expect(failed.file.execute).toMatchObject({ status: 'failed', summary: 'The work stopped before it finished.' });
    expect(failed.case.code).toBe(c.code);

    // Stage 7 doesn't pass work that didn't finish.
    await stages.beginStage(d.at('close'));
    expect((await stages.verifyClose(d.at('close'))).verified).toBe(false);
  });
});

describe('the kill switch', () => {
  it('holds a gate while the company is paused, and lets it open after resuming', async () => {
    const org = await newOrg(h, 'power-plant');
    const { d } = await upToApproval(org);
    await h.owner.query(`update tenants set status = 'paused' where id = $1`, [org.tenantId]);
    expect(await stages.beginStage(d.at('approve'))).toEqual({ paused: true });
    expect(await stages.openGate({ ...d.at('approve'), gate: 'proceed' })).toEqual({ status: 'paused' });
    await h.owner.query(`update tenants set status = 'active' where id = $1`, [org.tenantId]);
    expect((await stages.openGate({ ...d.at('approve'), gate: 'proceed' })).status).toBe('waiting');
  });
});
