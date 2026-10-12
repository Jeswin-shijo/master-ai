import { z } from 'zod';

/**
 * One scale is used for both agents and actions.
 *
 * - An action's level is what the policy engine decided for one proposed tool call.
 * - An agent's `autonomy` is its clearance: the highest level it may run without
 *   approval. Anything above its clearance is escalated to Level 4.
 */
export const AUTONOMY_LEVELS = {
  1: { name: 'Observe', description: 'Read-only actions.', runsWithoutApproval: true },
  2: {
    name: 'Draft & recommend',
    description: 'Drafts and internal notes. Nothing leaves the company.',
    runsWithoutApproval: true,
  },
  3: {
    name: 'Act within limits',
    description: 'Reversible writes and low-risk actions, inside budgets.',
    runsWithoutApproval: true,
  },
  4: { name: 'Act with approval', description: 'A human must approve first.', runsWithoutApproval: false },
  5: { name: 'Forbidden', description: 'Blocked and logged.', runsWithoutApproval: false },
} as const;

export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export const AutonomyLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** Agent clearance: 1–4 (5 would mean "may never act"; pause the agent instead). */
export const AgentClearanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type AgentClearance = z.infer<typeof AgentClearanceSchema>;

export const DataClassSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);
export type DataClass = z.infer<typeof DataClassSchema>;

export const ModelTierSchema = z.enum(['frontier', 'standard', 'small']);
export type ModelTier = z.infer<typeof ModelTierSchema>;
