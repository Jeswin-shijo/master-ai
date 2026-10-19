import { randomBytes, randomUUID } from 'node:crypto';
import { createDeviceKey, signApproval } from '@onehuman/sdk';
import { resolveTool, startJobState } from '@onehuman/agent-kit';
import type { JobInput, JobRunState } from '@onehuman/schemas';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { goals, jobRuns, tasks } from '../../src/db/schema';
import { GoalsService } from '../../src/goals/goals.service';
import { IdentityService } from '../../src/identity/identity.service';
import { KnowledgeService } from '../../src/knowledge/knowledge.service';
import { ListsService } from '../../src/lists/lists.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { AgentRuntimeService } from '../../src/orchestration/agent-runtime.service';
import { loadTaskContext } from '../../src/orchestration/context';
import { OrchestratorService } from '../../src/orchestration/orchestrator.service';
import { TaskLifecycleService } from '../../src/orchestration/task-lifecycle.service';
import { PolicyService } from '../../src/policy/policy.service';
import { RecordsService } from '../../src/records/records.service';
import { boot, newOrg, type Harness, type Org } from './harness';
import { installJobFixture, JOB_TESTER } from './jobs-fixture';

/**
 * Job runs through the ordinary task workflow: each test calls the workflow's
 * activities in the order taskWorkflow does (orchestration/workflows.ts), with
 * the job's script deciding each step instead of the model. LLM_OFFLINE=always,
 * so AI steps answer with their offline templates.
 */

let h: Harness;
let plant: Org;
let runtime: AgentRuntimeService;
let lifecycle: TaskLifecycleService;

beforeAll(async () => {
  h = await boot();
  plant = await newOrg(h, 'power-plant');
  runtime = h.get(AgentRuntimeService);
  lifecycle = h.get(TaskLifecycleService);
});
afterAll(() => h.close());
afterEach(() => vi.restoreAllMocks());

const RAVI = { text: 'Do you sell rooftop solar panels?', name: 'Ravi', phone: '+91 98000 11111' };

/** Until JobsService.startRun (Task 9): a goal, its one task and the job run, as startRun will insert them. */
async function begin(org: Org, job: { jobId: string; agentId: string }, input: Record<string, unknown>, origin: 'owner' | 'inbound' = 'owner') {
  const ids = await h.get(DbService).tenant(org.tenantId, async (tx) => {
    const [goal] = await tx
      .insert(goals)
      .values({ tenantId: org.tenantId, workspaceId: org.workspaceId, createdBy: org.session.principalId, text: `Spec run of ${job.jobId}`, origin, status: 'running' })
      .returning();
    const [task] = await tx
      .insert(tasks)
      .values({ tenantId: org.tenantId, goalId: goal!.id, key: `job-${job.jobId}`, title: `Spec run of ${job.jobId}`, description: 'Started by the spec', agentId: job.agentId })
      .returning();
    const [run] = await tx
      .insert(jobRuns)
      .values({
        tenantId: org.tenantId,
        workspaceId: org.workspaceId,
        jobId: job.jobId,
        agentId: job.agentId,
        goalId: goal!.id,
        taskId: task!.id,
        trigger: 'manual',
        dedupeKey: `manual:${randomUUID()}`,
        input,
        state: startJobState(),
      })
      .returning();
    return { goalId: goal!.id, taskId: task!.id, runId: run!.id };
  });
  await lifecycle.startTask(org.tenantId, ids.taskId);
  return { ...ids, at: { tenantId: org.tenantId, goalId: ids.goalId, taskId: ids.taskId } };
}

async function runRow(runId: string) {
  const { rows } = await h.owner.query<{ status: string; summary: string | null; finished_at: Date | null; state: JobRunState }>(
    `select status, summary, finished_at, state from job_runs where id = $1`,
    [runId],
  );
  return rows[0]!;
}

async function audits(taskId: string) {
  const { rows } = await h.owner.query<{ type: string; payload: Record<string, unknown> }>(`select type, payload from audit_events where task_id = $1 order by seq`, [taskId]);
  return rows;
}

async function toolCallRows(taskId: string) {
  const { rows } = await h.owner.query<{ id: string; tool: string; status: string; rationale: string; args: Record<string, unknown> }>(
    `select id, tool, status, rationale, args from tool_calls where task_id = $1 order by created_at`,
    [taskId],
  );
  return rows;
}

/** Decide as the owner, signed with a device key, as the apps do. */
async function decide(org: Org, approvalId: string, decision: 'approved' | 'rejected', notes?: string) {
  const pair = createDeviceKey(new Uint8Array(randomBytes(32)));
  const key = await h.get(IdentityService).registerDeviceKey(org.session, { publicKey: pair.publicKey, label: 'spec', platform: 'web' });
  const signedAt = new Date().toISOString();
  const signature = signApproval(pair.seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return h.get(ApprovalsService).decide(org.session, approvalId, { decision, notes, keyId: key.id, signedAt, signature });
}

const trigger = { manual: { input: 'Message' } };

describe('a job run, step by step through the task workflow', () => {
  const REPLY: JobInput = {
    id: 'spec-reply',
    name: 'Reply to enquiries',
    description: 'Drafts a reply to a customer enquiry for a person to send.',
    agent: JOB_TESTER,
    trigger,
    steps: [
      { read: { as: 'say', from: 'trigger' } },
      {
        ai: {
          as: 'draft',
          task: 'Write a short, friendly reply to the message.',
          output: [{ name: 'reply', type: 'text', required: true }],
          data: ['say'],
          customer: true,
          offline: { reply: 'Thank you {{ say.name }}, we have your message and a person will reply today.' },
        },
      },
      { check: { says_not: { text: 'draft.reply', phrases: ['guaranteed', 'free of cost'] }, on_fail: 'person', message: 'The reply promises something we do not offer' } },
      { act: { as: 'drafted', tool: 'message.draft', args: { channel: 'whatsapp', to: '{{ say.phone }}', body: '{{ draft.reply }}' } } },
    ],
  };

  it('reads, drafts with the offline template, checks, then acts through the policy engine and finishes', async () => {
    const job = await installJobFixture(h, plant, REPLY);
    const run = await begin(plant, job, RAVI);

    const first = await runtime.step(plant.tenantId, run.taskId);
    expect(first.kind).toBe('tool');
    const toolCallId = (first as { toolCallId: string }).toolCallId;
    const [call] = await toolCallRows(run.taskId);
    expect(call).toMatchObject({ id: toolCallId, tool: 'message.draft', status: 'proposed' });
    expect(call!.args).toMatchObject({ channel: 'whatsapp', to: RAVI.phone, body: 'Thank you Ravi, we have your message and a person will reply today.' });
    expect(call!.rationale).toMatch(/^Reply to enquiries: Draft .* to \+91 98000 11111/);
    expect((await audits(run.taskId)).map((a) => a.type)).toContain('action.proposed');

    // A retried step hands back the same proposal instead of a second one.
    expect(await runtime.step(plant.tenantId, run.taskId)).toEqual(first);
    expect(await toolCallRows(run.taskId)).toHaveLength(1);

    const { level } = await lifecycle.evaluateAction(plant.tenantId, run.taskId, toolCallId);
    expect(level).toBeLessThanOrEqual(3);
    await lifecycle.executeAction(plant.tenantId, run.taskId, toolCallId);
    const { rows: drafts } = await h.owner.query<{ status: string; payload: Record<string, unknown> }>(`select status, payload from outbox where tool_call_id = $1`, [toolCallId]);
    expect(drafts).toEqual([expect.objectContaining({ status: 'draft' })]);

    const second = await runtime.step(plant.tenantId, run.taskId);
    expect(second).toEqual({ kind: 'finish', output: { summary: 'Reply to enquiries finished' } });
    const row = await runRow(run.runId);
    expect(row.status).toBe('done');
    expect(row.summary).toBe('Reply to enquiries finished');
    expect(row.finished_at).not.toBeNull();
    expect(row.state.next).toBe(4);
    expect(row.state.results.drafted).toMatchObject({ status: 'draft' });
    const finished = (await audits(run.taskId)).filter((a) => a.type === 'job.run_finished');
    expect(finished).toEqual([expect.objectContaining({ payload: expect.objectContaining({ job: 'Reply to enquiries', status: 'done' }) })]);

    // The run has ended: asking again gives the same ending.
    expect(await runtime.step(plant.tenantId, run.taskId)).toEqual(second);
  });

  it('stops at an emergency word, alerts the owner and leaves the emergency reply as a draft', async () => {
    const DESK: JobInput = {
      id: 'spec-desk',
      name: 'Front desk reply',
      description: 'Answers a message at the front desk.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { check: { escalate: { text: '{{ say.text }}' }, on_fail: 'person', message: 'This message needs a person now' } },
        { act: { as: 'drafted', tool: 'message.draft', args: { channel: 'whatsapp', to: '{{ say.requester.phone }}', body: 'Thank you for writing to us.' } } },
      ],
    };
    const job = await installJobFixture(h, plant, DESK);
    const push = vi.spyOn(h.get(NotificationsService), 'pushToRole');
    const incoming = 'there is a fire in the godown';
    const run = await begin(plant, job, { text: incoming, requester: { name: 'Ravi', phone: RAVI.phone } });

    const step = await runtime.step(plant.tenantId, run.taskId);
    expect(step).toEqual({ kind: 'stop', reason: 'This message needs a person now' });
    expect((await runRow(run.runId)).status).toBe('needs_person');
    expect(await toolCallRows(run.taskId)).toEqual([]);

    const escalated = (await audits(run.taskId)).filter((a) => a.type === 'job.escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]!.payload).toMatchObject({ job: 'Front desk reply', set: 'emergency', label: 'Emergencies', words: ['fire'] });

    const { rows: drafts } = await h.owner.query<{ kind: string; status: string; payload: Record<string, unknown>; tool_call_id: string | null }>(
      `select kind, status, payload, tool_call_id from outbox where tenant_id = $1 and payload->>'jobRunId' = $2`,
      [plant.tenantId, run.runId],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'message', status: 'draft', tool_call_id: null });
    expect(drafts[0]!.payload).toMatchObject({ to: RAVI.phone, channel: 'whatsapp' });
    expect(String(drafts[0]!.payload.body)).toMatch(/call 112/);

    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith(plant.tenantId, 'owner', { title: 'Emergencies: Front desk reply', body: incoming, data: { goalId: run.goalId } });
  });

  it('waits for approval on a payment request from an inbound message, and stops when the owner says no', async () => {
    const PAY: JobInput = {
      id: 'spec-advance',
      name: 'Ask for the advance',
      description: 'Asks the customer for the site-visit advance.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { act: { as: 'asked', tool: 'payment.request', args: { amount: 5000, currency: 'INR', payer: '{{ say.phone }}', purpose: 'Advance for the site visit' } } },
      ],
    };
    const job = await installJobFixture(h, plant, PAY);
    const run = await begin(plant, job, RAVI, 'inbound');

    const step = await runtime.step(plant.tenantId, run.taskId);
    expect(step.kind).toBe('tool');
    const toolCallId = (step as { toolCallId: string }).toolCallId;
    const { level } = await lifecycle.evaluateAction(plant.tenantId, run.taskId, toolCallId);
    expect(level).toBe(4);
    const { rows: decided } = await h.owner.query<{ reasons: string[] }>(`select decision->'reasons' as reasons from tool_calls where id = $1`, [toolCallId]);
    expect(decided[0]!.reasons).toContain('Action was suggested by untrusted content (email, web page or document)');
    const approval = await lifecycle.requestApproval(plant.tenantId, run.taskId, toolCallId);

    // Still waiting: a retried step hands back the same proposal.
    expect(await runtime.step(plant.tenantId, run.taskId)).toEqual({ kind: 'tool', toolCallId });

    await decide(plant, approval.approvalId, 'rejected', 'Not before the visit');
    await lifecycle.resumeAfterApproval(plant.tenantId, run.taskId);
    const next = await runtime.step(plant.tenantId, run.taskId);
    expect(next.kind).toBe('stop');
    expect((next as { reason: string }).reason).toContain('not approved');
    expect((next as { reason: string }).reason).not.toMatch(/payment\.request/);
    const row = await runRow(run.runId);
    expect(row.status).toBe('stopped');
    expect(row.summary).toContain('not approved');
    expect((await audits(run.taskId)).filter((a) => a.type === 'job.run_finished')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ status: 'stopped' }) }),
    ]);
  });

  it('hands to a person when an AI step has no model and no offline template', async () => {
    const BARE: JobInput = {
      id: 'spec-no-template',
      name: 'Draft without a template',
      description: 'An AI step with no offline answer.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { ai: { as: 'draft', task: 'Write a reply.', output: [{ name: 'reply', type: 'text', required: true }], data: ['say'] } },
        { act: { as: 'drafted', tool: 'message.draft', args: { channel: 'whatsapp', to: '{{ say.phone }}', body: '{{ draft.reply }}' } } },
      ],
    };
    const job = await installJobFixture(h, plant, BARE);
    const run = await begin(plant, job, RAVI);
    expect(await runtime.step(plant.tenantId, run.taskId)).toEqual({ kind: 'stop', reason: 'No AI model is available for this step' });
    const row = await runRow(run.runId);
    expect(row.status).toBe('needs_person');
    expect(row.summary).toBe('No AI model is available for this step');
    expect(await toolCallRows(run.taskId)).toEqual([]);
    expect((await audits(run.taskId)).filter((a) => a.type === 'job.run_finished')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ status: 'needs_person' }) }),
    ]);
  });

  it('ends the run in plain words when an act does not fit its tool or a read finds no such list', async () => {
    const BAD_ACT: JobInput = {
      id: 'spec-bad-act',
      name: 'Draft by pigeon',
      description: 'An act whose details the tool does not take.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { act: { as: 'drafted', tool: 'message.draft', args: { channel: 'pigeon', to: '{{ say.phone }}', body: 'Hello' } } },
      ],
    };
    const bad = await installJobFixture(h, plant, BAD_ACT);
    const run = await begin(plant, bad, RAVI);
    expect(await runtime.step(plant.tenantId, run.taskId)).toEqual({ kind: 'stop', reason: 'Draft message could not be prepared from the data' });
    expect((await runRow(run.runId)).status).toBe('needs_person');
    expect((await toolCallRows(run.taskId)).map((c) => c.status)).toEqual(['failed']);

    const NO_LIST: JobInput = {
      id: 'spec-no-list',
      name: 'Read a missing list',
      description: 'A read of a list the workspace does not have.',
      agent: JOB_TESTER,
      trigger,
      steps: [{ read: { as: 'openPermits', from: 'list', list: 'no-such-list' } }],
    };
    const missing = await installJobFixture(h, plant, NO_LIST);
    const read = await begin(plant, missing, {});
    expect(await runtime.step(plant.tenantId, read.taskId)).toEqual({ kind: 'stop', reason: 'Could not read the open permits' });
    expect((await runRow(read.runId)).status).toBe('stopped');
  });

  it('leaves a task without a job run to the model loop', async () => {
    const goal = await h.get(GoalsService).create(plant.session, { text: 'Find the equipment that is due for maintenance this week', autoStart: true });
    const plan = await h.get(OrchestratorService).planGoal(plant.tenantId, goal.id, true);
    const taskId = plan.tasks[0]!.id;
    await lifecycle.startTask(plant.tenantId, taskId);
    const step = await runtime.step(plant.tenantId, taskId);
    expect(['tool', 'finish', 'invalid']).toContain(step.kind);
    const { rows } = await h.owner.query(`select 1 from job_runs where task_id = $1`, [taskId]);
    expect(rows).toEqual([]);
  });

  it('passes the quality check for a job task: its checks are the quality', async () => {
    const job = await installJobFixture(h, plant, REPLY);
    const run = await begin(plant, job, RAVI);
    expect(await runtime.qualityCheck(plant.tenantId, run.taskId, { summary: 'ok' })).toMatchObject({ pass: true });
  });
});

describe('a job card forbid compiles to a policy the engine applies', () => {
  it('blocks a forbidden tool at Level 5, for a catalog tool and a pack tool, and the run stops', async () => {
    const org = await newOrg(h, 'power-plant');
    const SEND: JobInput = {
      id: 'spec-send',
      name: 'Send the reply',
      description: 'Sends a reply straight to the customer.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { act: { as: 'sent', tool: 'message.send', args: { channel: 'whatsapp', to: '{{ say.phone }}', body: 'Thank you for writing to us.' } } },
      ],
    };
    const job = await installJobFixture(h, org, SEND, {
      tools: ['records.search', 'message.send', 'equipment.search'],
      job: { mission: 'Answers customers for the specs.', never: [], customer_facing: true, escalate: [], forbid: ['message.send', 'equipment.search'], trial_days: 14, metrics: [] },
    });

    const { rows } = await h.owner.query<{ pack_rules: { id?: string; forbid?: boolean; agent?: string }[]; cedar: string }>(
      `select pack_rules, cedar from policies where workspace_id = $1 order by version desc limit 1`,
      [org.workspaceId],
    );
    for (const id of ['job-forbid-job-tester-message-send', 'job-forbid-job-tester-equipment-search']) {
      expect(rows[0]!.pack_rules).toContainEqual(expect.objectContaining({ id, forbid: true, agent: JOB_TESTER }));
      expect(rows[0]!.cedar).toContain(id);
    }

    const run = await begin(org, job, RAVI);
    const step = await runtime.step(org.tenantId, run.taskId);
    expect(step.kind).toBe('tool');
    const toolCallId = (step as { toolCallId: string }).toolCallId;
    expect((await lifecycle.evaluateAction(org.tenantId, run.taskId, toolCallId)).level).toBe(5);
    expect((await toolCallRows(run.taskId))[0]!.status).toBe('blocked');
    const next = await runtime.step(org.tenantId, run.taskId);
    expect(next).toEqual({ kind: 'stop', reason: 'Send message was blocked' });
    expect((await runRow(run.runId)).status).toBe('stopped');

    // The pack's own alias tool is refused by name too.
    const decision = await h.get(DbService).tenant(org.tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, run.taskId);
      return h.get(PolicyService).decide({
        tx,
        tool: resolveTool(ctx.workspace.pack, 'equipment.search')!,
        args: { query: 'boiler' },
        agent: ctx.agent,
        workspace: { id: ctx.workspace.id, status: ctx.workspace.status },
        tenant: { id: ctx.tenant.id, status: ctx.tenant.status, settings: ctx.tenant.settings },
        moneySpentInr: 0,
        untrustedOrigin: false,
      });
    });
    expect(decision.level).toBe(5);
    expect(decision.reasons.join(' ')).toContain('Never handled by Job tester');
  });
});

describe('what a job reads', () => {
  it('reads records, open list items and company notes, and a duplicate check sees earlier runs', async () => {
    const org = await newOrg(h, 'power-plant');
    await h.get(ListsService).removeSamples(org.session);
    const add = (data: Record<string, unknown>) =>
      h.get(DbService).tenant(org.tenantId, async (tx) => {
        const records = h.get(RecordsService);
        return (await records.create(tx, org.tenantId, await records.activeWorkspace(tx), 'WorkPermit', data, SYSTEM, { kind: 'manual' })).id;
      });
    const confined = await add({ permitNo: 'SPEC-CS-1', permitType: 'confined-space', equipment: 'Coal mill 2', status: 'issued' });
    const electrical = await add({ permitNo: 'SPEC-EL-1', permitType: 'electrical', equipment: 'Feeder 7', status: 'issued', earthsFixed: 2 });
    await h.get(KnowledgeService).add(org.session, { title: 'Gas testing', content: 'Every confined space needs a gas test before anyone goes in.' });

    const READS: JobInput = {
      id: 'spec-reads',
      name: 'Morning permit check',
      description: 'Looks over the permits and the notes.',
      agent: JOB_TESTER,
      trigger,
      steps: [
        { read: { as: 'say', from: 'trigger' } },
        { read: { as: 'permits', from: 'records', entity: 'WorkPermit', when: { permitType: ['electrical'] }, limit: 5 } },
        { read: { as: 'open', from: 'list', list: 'work-permits', when: { status: ['issued'] }, limit: 5 } },
        { read: { as: 'notes', from: 'knowledge', query: 'gas test', limit: 3 } },
        { check: { duplicate: { key: 'permit-{{ say.permit }}' }, on_fail: 'stop', message: 'This permit was already looked at' } },
      ],
    };
    const job = await installJobFixture(h, org, READS);

    const first = await begin(org, job, { permit: 'SPEC-CS-1' });
    expect(await runtime.step(org.tenantId, first.taskId)).toEqual({ kind: 'finish', output: { summary: 'Morning permit check finished' } });
    const { results } = (await runRow(first.runId)).state;
    expect(results.permits).toEqual([expect.objectContaining({ id: electrical, permitNo: 'SPEC-EL-1', equipment: 'Feeder 7' })]);
    expect(results.open).toEqual([expect.objectContaining({ id: confined, title: 'SPEC-CS-1', permitNo: 'SPEC-CS-1', problems: [expect.any(String)] })]);
    // The pack's playbooks are company notes too; the spec's own note is among the passages found.
    expect(results.notes).toContainEqual({ id: expect.any(String), title: 'Gas testing', text: 'Every confined space needs a gas test before anyone goes in.' });
    expect(results.__seen).toEqual(['permit-SPEC-CS-1']);

    const again = await begin(org, job, { permit: 'SPEC-CS-1' });
    expect(await runtime.step(org.tenantId, again.taskId)).toEqual({ kind: 'stop', reason: 'This permit was already looked at' });
    expect((await runRow(again.runId)).status).toBe('stopped');

    const other = await begin(org, job, { permit: 'SPEC-EL-1' });
    expect((await runtime.step(org.tenantId, other.taskId)).kind).toBe('finish');
  });
});
