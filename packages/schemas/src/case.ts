import { z } from 'zod';
import { CaseRiskSchema, CaseSourceSchema, PriorityIdSchema, StageKeySchema } from './lifecycle';

/**
 * The case file: each stage reads it and adds its own part. Every part is
 * validated with its schema before it is stored.
 */

export const RequesterSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type Requester = z.infer<typeof RequesterSchema>;

export const RequestPartSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1),
  requester: RequesterSchema,
  source: CaseSourceSchema,
  receivedAt: z.string(),
  /** The requester's own words. Untrusted for customer, system and partner sources. */
  text: z.string().min(1),
  /** Amount typed into a form or sent by a system, in rupees. Wins over amounts read from the text. */
  amountInr: z.number().nonnegative().optional(),
  /** Case type chosen when the request was made (a trusted person starting a workflow). */
  presetCategory: z.string().optional(),
});
export type RequestPart = z.infer<typeof RequestPartSchema>;

export const ReviewPartSchema = z.object({
  outcome: z.enum(['complete', 'needs_info', 'not_eligible']),
  provisionalCategory: z.string().nullable(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string().optional() })),
  missing: z.array(z.object({ key: z.string(), label: z.string() })),
  /** Checks a person must confirm (they cannot be read from the request). */
  toConfirm: z.array(z.string()),
  reason: z.string().optional(),
});
export type ReviewPart = z.infer<typeof ReviewPartSchema>;

export const ClassifyPartSchema = z.object({
  category: z.string().min(1),
  categoryName: z.string().min(1),
  priority: PriorityIdSchema,
  risk: CaseRiskSchema,
  department: z.string().min(1),
  amountInr: z.number().nonnegative().nullable(),
  respondBy: z.string(),
  resolveBy: z.string(),
  reasons: z.array(z.string()),
});
export type ClassifyPart = z.infer<typeof ClassifyPartSchema>;

export const AssignPartSchema = z.object({
  assignee: z.object({ staffId: z.string().optional(), name: z.string(), title: z.string().optional() }).nullable(),
  team: z.string().min(1),
  deadline: z.string(),
  reason: z.string().min(1),
});
export type AssignPart = z.infer<typeof AssignPartSchema>;

export const ApprovePartSchema = z.object({
  required: z.boolean(),
  rule: z.string().optional(),
  approverRole: z.string().optional(),
  decision: z.enum(['approved', 'rejected', 'expired', 'not_required', 'blocked']),
  decidedBy: z.string().optional(),
  notes: z.string().optional(),
  approvalId: z.string().optional(),
});
export type ApprovePart = z.infer<typeof ApprovePartSchema>;

export const ExecutePartSchema = z.object({
  goalId: z.string(),
  workflow: z.string().optional(),
  status: z.string(),
  summary: z.string(),
  costInr: z.number().nonnegative(),
  evidence: z.array(z.string()),
});
export type ExecutePart = z.infer<typeof ExecutePartSchema>;

export const ClosePartSchema = z.object({
  verified: z.boolean(),
  findings: z.array(z.string()),
  signoff: z.object({
    required: z.boolean(),
    role: z.string().optional(),
    decision: z.enum(['approved', 'rejected', 'expired', 'not_required']).optional(),
    by: z.string().optional(),
  }),
  outcome: z.enum(['resolved', 'not_resolved']),
});
export type ClosePart = z.infer<typeof ClosePartSchema>;

export const ReportPartSchema = z.object({
  text: z.string().min(1),
  slaMet: z.boolean().nullable(),
  minutesPerStage: z.array(z.object({ stage: StageKeySchema, minutes: z.number().nonnegative() })),
  recurring: z.object({ count: z.number().int().positive(), note: z.string() }).nullable(),
});
export type ReportPart = z.infer<typeof ReportPartSchema>;

export const CaseFileSchema = z.object({
  request: RequestPartSchema.optional(),
  review: ReviewPartSchema.optional(),
  classify: ClassifyPartSchema.optional(),
  assign: AssignPartSchema.optional(),
  approve: ApprovePartSchema.optional(),
  execute: ExecutePartSchema.optional(),
  close: ClosePartSchema.optional(),
  report: ReportPartSchema.optional(),
});
export type CaseFile = z.infer<typeof CaseFileSchema>;

/** Which schema validates which stage's output. */
export const STAGE_PART_SCHEMAS = {
  request: RequestPartSchema,
  review: ReviewPartSchema,
  classify: ClassifyPartSchema,
  assign: AssignPartSchema,
  approve: ApprovePartSchema,
  execute: ExecutePartSchema,
  close: ClosePartSchema,
  report: ReportPartSchema,
} as const;
