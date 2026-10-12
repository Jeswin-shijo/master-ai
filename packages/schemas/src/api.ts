import { z } from 'zod';
import { AgentClearanceSchema } from './autonomy';
import { BudgetsSchema, RoutineQuestionSchema, ToolNameSchema } from './pack';

/** Request bodies. The backend validates with these; the SDK sends them. */

export const SignupInputSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  /** Free text: "travel agency", "dental clinic in Kochi", "coaching institute"... */
  industry: z.string().trim().min(2).max(200),
});
export type SignupInput = z.input<typeof SignupInputSchema>;

export const LoginInputSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
  /** Pick a tenant when the user belongs to several. */
  tenantId: z.uuid().optional(),
});
export type LoginInput = z.input<typeof LoginInputSchema>;

export const PackPreviewInputSchema = z.object({
  /** Defaults to the industry given at signup. */
  industry: z.string().trim().min(2).max(200).optional(),
  /** Skip registry matching and always generate a pack. */
  forceGenerate: z.boolean().optional(),
});
export type PackPreviewInput = z.input<typeof PackPreviewInputSchema>;

export const PackInstallInputSchema = z.object({
  draftId: z.uuid(),
  /** Add a few sample records per entity so agents have something to work on. */
  sampleData: z.boolean().optional(),
});
export type PackInstallInput = z.input<typeof PackInstallInputSchema>;

export const CreateGoalInputSchema = z.object({
  text: z.string().trim().min(3).max(2000),
  workspaceId: z.uuid().optional(),
  /** Skip the plan-approval step and run the plan straight away. */
  autoStart: z.boolean().optional(),
});
export type CreateGoalInput = z.input<typeof CreateGoalInputSchema>;

export const PlanDecisionInputSchema = z.object({
  approved: z.boolean(),
  notes: z.string().max(2000).optional(),
});
export type PlanDecisionInput = z.input<typeof PlanDecisionInputSchema>;

export const ApprovalDecisionInputSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'edited']),
    notes: z.string().max(2000).optional(),
    /** Replacement tool arguments when `decision` is `edited`. */
    editedArgs: z.record(z.string(), z.unknown()).optional(),
    /** Ed25519 signature (base64) over `approvalSigningMessage(...)`. */
    signature: z.string().min(1),
    keyId: z.uuid(),
    signedAt: z.iso.datetime(),
  })
  .refine((d) => d.decision !== 'edited' || d.editedArgs, {
    message: 'editedArgs is required when decision is edited',
    path: ['editedArgs'],
  });
export type ApprovalDecisionInput = z.input<typeof ApprovalDecisionInputSchema>;

export const BatchApprovalInputSchema = z.object({
  decisions: z
    .array(
      z.object({
        approvalId: z.uuid(),
        decision: z.enum(['approved', 'rejected']),
        notes: z.string().max(2000).optional(),
        signature: z.string().min(1),
        keyId: z.uuid(),
        signedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(50),
});
export type BatchApprovalInput = z.input<typeof BatchApprovalInputSchema>;

export const RegisterDeviceKeyInputSchema = z.object({
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: z.string().min(40).max(64),
  label: z.string().trim().min(1).max(80),
  platform: z.enum(['web', 'ios', 'android']),
});
export type RegisterDeviceKeyInput = z.input<typeof RegisterDeviceKeyInputSchema>;

export const RegisterPushTokenInputSchema = z.object({
  token: z.string().min(1).max(300),
  platform: z.enum(['ios', 'android']),
});
export type RegisterPushTokenInput = z.input<typeof RegisterPushTokenInputSchema>;

export const UpdateAgentInputSchema = z.object({
  autonomy: AgentClearanceSchema.optional(),
  budgets: BudgetsSchema.partial().optional(),
  instructions: z.string().max(4000).optional(),
});
export type UpdateAgentInput = z.input<typeof UpdateAgentInputSchema>;

export const AutonomyOverrideInputSchema = z.object({
  tool: ToolNameSchema,
  /** Earned autonomy lowers an action to at most Level 3. */
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type AutonomyOverrideInput = z.input<typeof AutonomyOverrideInputSchema>;

export const CreateRecordInputSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
export type CreateRecordInput = z.input<typeof CreateRecordInputSchema>;

export const CreateKnowledgeDocInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(200_000),
});
export type CreateKnowledgeDocInput = z.input<typeof CreateKnowledgeDocInputSchema>;

export const TenantSettingsInputSchema = z.object({
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  redactPii: z.boolean().optional(),
  calls: z.lazy(() => CallSettingsInputSchema).optional(),
});
export type TenantSettingsInput = z.input<typeof TenantSettingsInputSchema>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const WorkingHoursSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
  start: HHMM.default('09:00'),
  end: HHMM.default('19:00'),
});

export const CreateStaffInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** E.164 preferred, e.g. +919876543210. */
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,18}$/, 'Phone number like +91 98765 43210'),
  title: z.string().trim().min(1).max(120),
  /** What this person is in charge of, e.g. ["bookings", "Kochi branch", "hotel inspections"]. */
  responsibilities: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  workingHours: WorkingHoursSchema.prefault({}),
  language: z.enum(['en']).default('en'),
});
export type CreateStaffInput = z.input<typeof CreateStaffInputSchema>;

export const UpdateStaffInputSchema = CreateStaffInputSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});
export type UpdateStaffInput = z.input<typeof UpdateStaffInputSchema>;

export const CallReplyInputSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export type CallReplyInput = z.input<typeof CallReplyInputSchema>;

export const CallSettingsInputSchema = z.object({
  provider: z.enum(['simulator', 'twilio']).optional(),
  simulatorMode: z.enum(['auto', 'interactive']).optional(),
  fastSchedule: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  retryMinutes: z.number().int().min(1).max(240).optional(),
});

// ---------- Routines ----------

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const DaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7);

/** Start a routine from one of the pack's templates, or from scratch. */
export const CreateRoutineInputSchema = z.object({
  templateId: z.string().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  mode: z.enum(['manual', 'automatic']).optional(),
  days: DaysSchema.optional(),
  time: TimeSchema.optional(),
  chaseMissing: z.boolean().optional(),
  questions: z.array(RoutineQuestionSchema).min(1).max(8).optional(),
  /** Who reports. Defaults to everyone active on the team. */
  staffIds: z.array(z.uuid()).optional(),
});
export type CreateRoutineInput = z.input<typeof CreateRoutineInputSchema>;

export const UpdateRoutineInputSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  mode: z.enum(['manual', 'automatic']).optional(),
  days: DaysSchema.optional(),
  time: TimeSchema.optional(),
  chaseMissing: z.boolean().optional(),
  questions: z.array(RoutineQuestionSchema).min(1).max(8).optional(),
  staffIds: z.array(z.uuid()).optional(),
  status: z.enum(['active', 'paused']).optional(),
});
export type UpdateRoutineInput = z.input<typeof UpdateRoutineInputSchema>;

/** A check-in filled in by hand (manual mode, or correcting what a call collected). */
export const CheckinInputSchema = z.object({
  staffId: z.uuid(),
  values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])),
});
export type CheckinInput = z.input<typeof CheckinInputSchema>;
