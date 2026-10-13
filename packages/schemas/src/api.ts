import { z } from 'zod';
import { AgentClearanceSchema } from './autonomy';
import { BudgetsSchema, RoutineQuestionSchema, ToolNameSchema } from './pack';
import { SectorIdSchema } from './lifecycle';

/** Request bodies. The backend validates with these; the SDK sends them. */

export const SignupInputSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  /** The sector picked on the first signup screen. */
  sector: SectorIdSchema,
  /** A ready-made organization type (its pack id), or the owner's own words for "Something else". */
  orgType: z.string().trim().min(2).max(200),
  /** The owner's words about the business. Defaults to the organization type's name. */
  industry: z.string().trim().min(2).max(200).optional(),
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
  needsInfoDays: z.number().int().min(1).max(60).optional(),
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

export const RequesterInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(40).optional(),
  email: z.email().optional(),
});
export type RequesterInput = z.input<typeof RequesterInputSchema>;

const CaseTextSchema = z.string().trim().min(3).max(4000);
const AmountSchema = z.number().nonnegative().max(1e12);

/** "New request" in the apps. */
export const CreateCaseInputSchema = z.object({
  text: CaseTextSchema,
  title: z.string().trim().min(1).max(120).optional(),
  workspaceId: z.uuid().optional(),
  /** Who the request is for, when it isn't the person typing it (a walk-in customer, a caller). */
  requester: RequesterInputSchema.optional(),
  amountInr: AmountSchema.optional(),
  /** Case type chosen up front, e.g. from the Workflows gallery. */
  category: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
});
export type CreateCaseInput = z.input<typeof CreateCaseInputSchema>;

export const CaseInfoInputSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export type CaseInfoInput = z.input<typeof CaseInfoInputSchema>;

export const CancelCaseInputSchema = z.object({ reason: z.string().trim().max(500).optional() });
export type CancelCaseInput = z.input<typeof CancelCaseInputSchema>;

/** Systems and partners: `POST /intake/:tenantId/cases` with an intake API key. */
export const IntakeCaseInputSchema = z.object({
  text: CaseTextSchema,
  title: z.string().trim().min(1).max(120).optional(),
  requester: RequesterInputSchema,
  /** Their own id for the event. A repeat with the same ref returns the same case. */
  externalRef: z.string().trim().min(1).max(200).optional(),
  amountInr: AmountSchema.optional(),
});
export type IntakeCaseInput = z.input<typeof IntakeCaseInputSchema>;

/** Customers: the public request form. */
export const PublicFormInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(40).optional(),
    email: z.email().optional(),
    text: CaseTextSchema,
  })
  .refine((f) => !!f.phone || !!f.email, 'Give a phone number or an email so we can reach you');
export type PublicFormInput = z.input<typeof PublicFormInputSchema>;

export const CreateIntakeKeyInputSchema = z
  .object({
    kind: z.enum(['form', 'api']),
    label: z.string().trim().min(1).max(80),
    /** API keys only: what kind of sender this is. Forms are always customers. */
    source: z.enum(['system', 'partner']).optional(),
  })
  .refine((k) => k.kind === 'form' || !!k.source, 'An API key needs a source: system or partner');
export type CreateIntakeKeyInput = z.input<typeof CreateIntakeKeyInputSchema>;

const ApproverRoleIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** Owner or admin: invite a person by email. The link goes to them however the owner likes. */
export const CreateInviteInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(['admin', 'member']).default('member'),
  approverRoles: z.array(ApproverRoleIdSchema).max(20).default([]),
});
export type CreateInviteInput = z.input<typeof CreateInviteInputSchema>;

/** The invited person: a new password, or their existing one when the email already has a login. */
export const AcceptInviteInputSchema = z.object({
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
});
export type AcceptInviteInput = z.input<typeof AcceptInviteInputSchema>;

export const UpdateMemberInputSchema = z
  .object({
    role: z.enum(['admin', 'member']).optional(),
    approverRoles: z.array(ApproverRoleIdSchema).max(20).optional(),
    /** Link the team-directory record this person answers calls as; null unlinks. */
    staffId: z.uuid().nullable().optional(),
  })
  .refine((m) => m.role !== undefined || m.approverRoles !== undefined || m.staffId !== undefined, 'Nothing to change');
export type UpdateMemberInput = z.input<typeof UpdateMemberInputSchema>;
