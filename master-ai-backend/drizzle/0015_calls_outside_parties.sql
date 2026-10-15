CREATE TABLE "do_not_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"reason" text NOT NULL,
	"record_id" uuid,
	"call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"follow_up" text NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"last_call_at" timestamp with time zone,
	"next_due_on" date NOT NULL,
	"state" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_switches" (
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"follow_up" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_switches_tenant_id_workspace_id_follow_up_pk" PRIMARY KEY("tenant_id","workspace_id","follow_up")
);
--> statement-breakpoint
CREATE TABLE "record_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"call_id" uuid,
	"follow_up" text,
	"kind" text NOT NULL,
	"speaker" text NOT NULL,
	"said" text NOT NULL,
	"proposed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promise_on" date,
	"status" text DEFAULT 'new' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "staff_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "follow_up" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "collect" jsonb;--> statement-breakpoint
ALTER TABLE "do_not_call" ADD CONSTRAINT "do_not_call_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_call" ADD CONSTRAINT "do_not_call_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_not_call" ADD CONSTRAINT "do_not_call_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_attempts" ADD CONSTRAINT "follow_up_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_attempts" ADD CONSTRAINT "follow_up_attempts_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_switches" ADD CONSTRAINT "follow_up_switches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_switches" ADD CONSTRAINT "follow_up_switches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "do_not_call_phone_idx" ON "do_not_call" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_attempts_item_idx" ON "follow_up_attempts" USING btree ("record_id","follow_up");--> statement-breakpoint
CREATE INDEX "follow_up_attempts_tenant_idx" ON "follow_up_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "record_notes_record_idx" ON "record_notes" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "record_notes_status_idx" ON "record_notes" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_record_idx" ON "calls" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_who" CHECK ("calls"."staff_id" is not null or "calls"."contact_phone" is not null);