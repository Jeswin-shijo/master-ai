CREATE TABLE "case_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"summary" text,
	"actor" text,
	"workflow_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"requester" jsonb NOT NULL,
	"external_ref" text,
	"category" text,
	"category_name" text,
	"priority" text,
	"risk" text,
	"department" text,
	"amount_inr" numeric(14, 2),
	"assignee" jsonb,
	"respond_by" timestamp with time zone,
	"resolve_by" timestamp with time zone,
	"stage" text DEFAULT 'request' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"file" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"goal_id" uuid,
	"workflow_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intake_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"key_hash" text NOT NULL,
	"hint" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_counters" (
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_counters_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind")
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "goal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "tool_call_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "kind" text DEFAULT 'action' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "source" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "principals" ADD COLUMN "approver_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "principal_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "org_type" text;--> statement-breakpoint
ALTER TABLE "case_stages" ADD CONSTRAINT "case_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_stages" ADD CONSTRAINT "case_stages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_keys" ADD CONSTRAINT "intake_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_keys" ADD CONSTRAINT "intake_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_counters" ADD CONSTRAINT "workspace_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_counters" ADD CONSTRAINT "workspace_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_stages_attempt_idx" ON "case_stages" USING btree ("case_id","stage","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_workspace_number_idx" ON "cases" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_external_ref_idx" ON "cases" USING btree ("tenant_id","external_ref") WHERE "cases"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "cases_tenant_status_idx" ON "cases" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "cases_category_idx" ON "cases" USING btree ("tenant_id","category","created_at");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_case_idx" ON "approval_requests" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_docs_ref_idx" ON "knowledge_docs" USING btree ("tenant_id","ref") WHERE "knowledge_docs"."ref" is not null;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_kind_refs" CHECK (("approval_requests"."kind" = 'action' and "approval_requests"."goal_id" is not null and "approval_requests"."task_id" is not null and "approval_requests"."tool_call_id" is not null) or ("approval_requests"."kind" = 'case_gate' and "approval_requests"."case_id" is not null and "approval_requests"."stage" is not null));