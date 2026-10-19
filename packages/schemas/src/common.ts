import { z } from 'zod';

/** Building blocks shared by pack.ts and jobs.ts (kept apart so the two don't import each other). */

export const SlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter');

/** Dotted tool name, e.g. `records.search` or `booking.confirm`. */
export const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'dotted lowercase name, e.g. booking.confirm');

/** A field condition: one of these values, a number above or below, or filled / blank. */
export const ConditionSchema = z.union([
  z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  z.strictObject({ above: z.number() }),
  z.strictObject({ below: z.number() }),
  z.enum(['filled', 'blank']),
]);
export type Condition = z.infer<typeof ConditionSchema>;
export const ConditionsSchema = z.record(z.string(), ConditionSchema);
export type Conditions = z.infer<typeof ConditionsSchema>;

/** When a list item is due: the same overdue or expiring rule a check and a follow-up use. */
export const DueRuleSchema = z.union([
  z.strictObject({ overdue: z.strictObject({ date: z.string(), grace_days: z.number().int().nonnegative().default(0) }) }),
  z.strictObject({ expiring: z.strictObject({ date: z.string(), days: z.number().int().positive() }) }),
]);
export type DueRule = z.infer<typeof DueRuleSchema>;
