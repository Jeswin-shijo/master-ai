import { z } from 'zod';
import type { DataClass } from '@onehuman/schemas';

/**
 * Generic tool primitives. Every industry tool is either one of these or a
 * pack alias built on one (see ToolAlias in @onehuman/schemas). Connectors
 * (WhatsApp, Razorpay, Tally, MCP servers...) implement these primitives; until
 * a connector is attached, the sandbox connector records the action in the
 * outbox instead of reaching the outside world.
 */

export type ToolCategory = 'read' | 'draft' | 'write' | 'external' | 'money';

export interface ToolRisk {
  category: ToolCategory;
  reversible: boolean;
  externalReach: boolean;
  movesMoney: boolean;
  /** Money leaves the company (counts against the agent's money budget). */
  spendsMoney: boolean;
  sensitivity: DataClass;
}

export interface CatalogTool {
  name: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  /** Lowest level this tool can ever run at. */
  baseLevel: 1 | 2 | 3 | 4;
  risk: ToolRisk;
  /**
   * Runtime control: `handoff` ends the task for a human; `delegate` hands the
   * work to a team member and runs the phone-call cadence (assign → follow up →
   * confirm) before the agent continues; `gate` is a case stage gate (stage 5
   * or 7), decided by the policy engine and never called by work agents.
   */
  control?: 'handoff' | 'delegate' | 'gate';
}

const channel = z.enum(['email', 'whatsapp', 'sms']);
const money = z.number().positive().describe('Amount in major currency units, e.g. rupees');
const currency = z.string().length(3).default('INR');

const read = (sensitivity: DataClass = 'internal'): ToolRisk => ({
  category: 'read',
  reversible: true,
  externalReach: false,
  movesMoney: false,
  spendsMoney: false,
  sensitivity,
});

/** Gate tools are held only by this agent role. */
export const CASE_COORDINATOR_ROLE = 'case-coordinator';
export const GATE_TOOLS = ['case.proceed', 'case.close'] as const;

const gateInput = z.object({
  caseId: z.string().min(1),
  category: z.string().min(1),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  risk: z.enum(['low', 'medium', 'high']),
  amount: z.number().nonnegative().optional().describe('Money at stake in rupees, if any'),
  summary: z.string().min(1),
});

/** Gates commit the organization to work (and often money) but move nothing themselves. */
const gateRisk: ToolRisk = {
  category: 'write',
  reversible: true,
  externalReach: false,
  movesMoney: true,
  spendsMoney: false,
  sensitivity: 'internal',
};

export const TOOL_CATALOG: readonly CatalogTool[] = [
  {
    name: 'records.search',
    description:
      'Search business records of one entity type. Use a free-text query and/or exact-match filters on fields.',
    input: z.object({
      entity: z.string().describe('Entity name, e.g. Booking'),
      query: z.string().optional().describe('Free-text search across all fields'),
      filter: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Exact-match field filters, e.g. {"status": "new"}'),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    baseLevel: 1,
    risk: read(),
  },
  {
    name: 'records.get',
    description: 'Fetch one business record by id.',
    input: z.object({ entity: z.string(), id: z.string() }),
    baseLevel: 1,
    risk: read(),
  },
  {
    name: 'records.create',
    description: 'Create a business record. `data` must match the entity fields.',
    input: z.object({ entity: z.string(), data: z.record(z.string(), z.unknown()) }),
    baseLevel: 2,
    risk: { ...read(), category: 'write' },
  },
  {
    name: 'records.update',
    description: 'Update fields on an existing business record.',
    input: z.object({
      entity: z.string(),
      id: z.string(),
      patch: z.record(z.string(), z.unknown()).default({}),
    }),
    baseLevel: 3,
    risk: { ...read(), category: 'write' },
  },
  {
    name: 'knowledge.search',
    description: "Search the company's knowledge base: SOPs, policies, price lists, product data.",
    input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) }),
    baseLevel: 1,
    risk: read(),
  },
  {
    name: 'message.draft',
    description: 'Write a message draft for a human to review. Nothing is sent.',
    input: z.object({
      channel,
      to: z.string().describe('Recipient email, phone number or name'),
      subject: z.string().optional(),
      body: z.string().min(1),
    }),
    baseLevel: 2,
    risk: { ...read(), category: 'draft' },
  },
  {
    name: 'message.send',
    description: 'Send a message to a customer, supplier or partner. It cannot be unsent.',
    input: z.object({
      channel,
      to: z.string().describe('Recipient email or phone number'),
      subject: z.string().optional(),
      body: z.string().min(1),
    }),
    baseLevel: 3,
    risk: {
      category: 'external',
      reversible: false,
      externalReach: true,
      movesMoney: false,
      spendsMoney: false,
      sensitivity: 'internal',
    },
  },
  {
    name: 'payment.request',
    description: 'Send a payment link (UPI/card) asking someone to pay the company.',
    input: z.object({
      amount: money,
      currency,
      payer: z.string().describe('Payer name, email or phone'),
      purpose: z.string().min(1),
      dueDate: z.string().optional().describe('YYYY-MM-DD'),
    }),
    baseLevel: 3,
    risk: {
      category: 'money',
      reversible: true,
      externalReach: true,
      movesMoney: true,
      spendsMoney: false,
      sensitivity: 'confidential',
    },
  },
  {
    name: 'refund.issue',
    description: 'Refund money to a customer. Money leaves the company and cannot be pulled back.',
    input: z.object({
      amount: money,
      currency,
      recipient: z.string(),
      reason: z.string().min(1),
      recordRef: z.string().optional().describe('Related record id, e.g. a booking or order'),
    }),
    baseLevel: 3,
    risk: {
      category: 'money',
      reversible: false,
      externalReach: true,
      movesMoney: true,
      spendsMoney: true,
      sensitivity: 'confidential',
    },
  },
  {
    name: 'schedule.create',
    description: 'Put an appointment, visit or reminder on the company calendar.',
    input: z.object({
      title: z.string().min(1),
      start: z.string().describe('ISO date-time'),
      end: z.string().optional(),
      attendees: z.array(z.string()).default([]),
      location: z.string().optional(),
      notes: z.string().optional(),
    }),
    baseLevel: 3,
    risk: {
      category: 'write',
      reversible: true,
      externalReach: true,
      movesMoney: false,
      spendsMoney: false,
      sensitivity: 'internal',
    },
  },
  {
    name: 'document.generate',
    description: 'Write a document (quote, invoice draft, itinerary, report, letter) in Markdown.',
    input: z.object({
      kind: z.enum(['quote', 'invoice', 'itinerary', 'report', 'letter', 'other']),
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    baseLevel: 2,
    risk: { ...read(), category: 'draft' },
  },
  {
    name: 'staff.delegate',
    description:
      "Hand a piece of work to the team member in charge of it. The AI phones them to assign it and agree a deadline, calls again to follow up, then calls to confirm it is done. Returns the outcome: done, declined, blocked, not done or unreachable, with what they said.",
    input: z.object({
      assignee: z.string().min(1).describe('Name, job title or responsibility of the team member, e.g. "Ravi" or "operations manager"'),
      task: z.string().min(5).describe('What needs to be done, in one or two plain sentences the person will hear on the phone'),
      details: z.string().optional().describe('Anything else they need to know'),
      due: z.string().optional().describe('Deadline as an ISO date-time, only if the owner gave one'),
    }),
    baseLevel: 3,
    risk: { ...read(), category: 'write' },
    control: 'delegate',
  },
  {
    name: 'human.handoff',
    description:
      'Stop and hand the task to a human when you are blocked, unsure, or the request is outside your role.',
    input: z.object({ reason: z.string().min(1), question: z.string().optional() }),
    baseLevel: 1,
    risk: read(),
    control: 'handoff',
  },
  {
    name: 'case.proceed',
    description: 'Let a case pass its approval gate and move into the work.',
    input: gateInput,
    baseLevel: 3,
    risk: gateRisk,
    control: 'gate',
  },
  {
    name: 'case.close',
    description: 'Close a case once its result is verified.',
    input: gateInput,
    baseLevel: 3,
    risk: gateRisk,
    control: 'gate',
  },
];

const byName = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

export function getCatalogTool(name: string): CatalogTool | undefined {
  return byName.get(name);
}

/** Runtime tool every agent gets: ends the task with a result. */
export const FINISH_TOOL = {
  name: 'task.finish',
  description:
    'Finish the task. Call this once the task is done, or when nothing more can be done, with a short summary of what you did and what is left.',
  input: z.object({
    summary: z.string().min(1).describe('Plain-language summary for the business owner'),
    data: z.record(z.string(), z.unknown()).optional().describe('Structured result, if any'),
  }),
};
