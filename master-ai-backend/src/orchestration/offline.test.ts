import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { composeOfflinePack, fromWireName, parsePack, resolvePack, toolsForAgent } from '@onehuman/agent-kit';
import { offlineAgentStep, offlinePlan } from './offline';

const PACKS = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS)) {
  const file = join(PACKS, dir, 'pack.yaml');
  if (existsSync(file)) {
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
}
const travel = resolvePack(registry.get('travel-agency')!, (id) => registry.get(id));

describe('offline planner', () => {
  it('picks the workflow whose name fits the goal', () => {
    const plan = offlinePlan('Refund ₹12,000 to Asha Menon because her Munnar trip was cancelled', travel);
    expect(plan.rationale).toMatch(/Refund request/);
    expect(plan.tasks.map((t) => t.agentRole)).toEqual(['booking-coordinator']);
  });

  it('keeps workflow dependencies', () => {
    const plan = offlinePlan('Follow up on all overdue enquiries this week', travel);
    expect(plan.tasks.map((t) => t.key)).toEqual(['find-overdue', 'send-follow-ups']);
    expect(plan.tasks[1]!.dependsOn).toEqual(['find-overdue']);
  });

  it('falls back to the best-fitting agent when no workflow matches', () => {
    const plan = offlinePlan('Zzzz qqqq', travel);
    expect(plan.tasks).toHaveLength(1);
  });

  it('plans for a generated pack too', () => {
    const clinic = resolvePack(composeOfflinePack('Dental clinic'), (id) => registry.get(id), 'generated');
    const plan = offlinePlan('Book a cleaning appointment for Rahul Nair tomorrow', clinic);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.every((t) => clinic.agents.some((a) => a.role === t.agentRole))).toBe(true);
  });
});

describe('offline agent', () => {
  const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
  const tools = toolsForAgent(travel, coordinator.tools);
  const base = {
    goalText: 'Refund ₹12,000 to Asha Menon because her Munnar trip was cancelled',
    taskTitle: 'Check the request and refund',
    taskDescription: 'Find the booking and issue the refund.',
    pack: travel,
    tools,
  };

  it('looks before it acts', () => {
    const out = offlineAgentStep({ ...base, history: [] });
    expect(fromWireName(out.toolCalls![0]!.name)).toMatch(/search/);
  });

  it('then proposes the action with details from the goal', () => {
    const out = offlineAgentStep({
      ...base,
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 0, records: [] }, error: null }],
    });
    const call = out.toolCalls![0]!;
    expect(fromWireName(call.name)).toBe('refund.issue');
    expect(call.input).toMatchObject({ amount: 12000, recipient: 'Asha Menon', reason: 'her Munnar trip was cancelled' });
  });

  it('finishes and reports a rejection', () => {
    const out = offlineAgentStep({
      ...base,
      history: [
        { tool: 'records.search', status: 'executed', args: {}, result: { count: 0 }, error: null },
        { tool: 'refund.issue', status: 'rejected', args: {}, result: null, error: null, notes: 'Wait for supplier' },
      ],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toMatch(/rejected by the owner \("Wait for supplier"\)/);
  });
});

describe('offline planner: cancellations', () => {
  it('routes a cancellation to the cancel workflow, not the booking one', () => {
    const plan = offlinePlan('Cancel the booking for Rahul Nair, he is not travelling', travel);
    expect(plan.rationale).toMatch(/Cancel a booking/);
  });

  it('searches for the person named in the goal', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: "Find the customer's Booking record and cancel it.",
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [],
    });
    expect(out.toolCalls![0]!.input).toMatchObject({ entity: 'Booking', query: 'Rahul Nair' });
  });
});

describe('offline agent: no invented money', () => {
  it('does not propose a refund when no amount is known', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Sort out a refund for Rahul Nair',
      taskTitle: 'Refund the customer',
      taskDescription: 'Issue the refund.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools).filter((t) => t.name === 'refund.issue'),
      history: [],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
  });

  it('cancels when the task title says cancel', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair, he is not travelling',
      taskTitle: 'Cancel the booking',
      taskDescription: "Find the customer's Booking record and cancel it. If they already paid, a refund can follow.",
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 1, records: [{ id: 'b-1', customerName: 'Rahul Nair' }] }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('booking.cancel');
    expect(out.toolCalls![0]!.input).toMatchObject({ id: 'b-1' });
  });
});

describe('offline agent: stays on task', () => {
  it('reports "not found" instead of falling back to a different action', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: 'If they already paid, a refund can follow.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [{ tool: 'records.search', status: 'executed', args: {}, result: { count: 0, records: [] }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toMatch(/Could not cancel/);
  });

  it('takes search filters from the owner, not from instructions', () => {
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    const out = offlineAgentStep({
      goalText: 'Cancel the booking for Rahul Nair',
      taskTitle: 'Cancel the booking',
      taskDescription: 'If they already paid, a refund can follow.',
      pack: travel,
      tools: toolsForAgent(travel, coordinator.tools),
      history: [],
    });
    expect(out.toolCalls![0]!.input).not.toHaveProperty('filter');
  });
});

describe('offline agent: delegation', () => {
  const core = resolvePack(registry.get('core-business')!, (id) => registry.get(id));
  const coordinator = core.agents.find((a) => a.role === 'work-coordinator')!;
  const team = [
    { name: 'Ravi Kumar', title: 'Operations manager', responsibilities: ['hotels', 'inspections'] },
    { name: 'Meera Joseph', title: 'Accounts executive', responsibilities: ['payments', 'invoices'] },
  ];
  const base = {
    goalText: 'Collect the pending invoice payments from Sharma Traders by Friday',
    taskTitle: 'Delegate to the person in charge',
    taskDescription: 'Pick the team member in charge of this work and delegate it by phone.',
    pack: core,
    tools: toolsForAgent(core, coordinator.tools),
    team,
  };

  it('delegates straight away to the best-matching person, with the deadline', () => {
    const out = offlineAgentStep({ ...base, history: [] });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('staff.delegate');
    expect(out.toolCalls![0]!.input).toMatchObject({ assignee: 'Meera Joseph', task: base.goalText });
    expect(out.toolCalls![0]!.input.due).toBeTruthy();
  });

  it('finishes with what the person confirmed', () => {
    const out = offlineAgentStep({
      ...base,
      history: [{ tool: 'staff.delegate', status: 'executed', args: {}, result: { status: 'done', summary: "Meera confirmed it's done." }, error: null }],
    });
    expect(fromWireName(out.toolCalls![0]!.name)).toBe('task.finish');
    expect(String(out.toolCalls![0]!.input.summary)).toContain("Meera confirmed it's done");
  });
});
