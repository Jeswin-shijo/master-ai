import { z } from 'zod';

export { AUTONOMY_LEVELS } from './values';

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
