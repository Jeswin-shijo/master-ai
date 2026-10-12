CREATE TABLE "routine_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'automatic' NOT NULL,
	"days" integer[] NOT NULL,
	"time" text NOT NULL,
	"chase_missing" boolean DEFAULT true NOT NULL,
	"questions" jsonb NOT NULL,
	"staff_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "delegation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "checkin_id" uuid;--> statement-breakpoint
ALTER TABLE "routine_entries" ADD CONSTRAINT "routine_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_entries" ADD CONSTRAINT "routine_entries_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_entries" ADD CONSTRAINT "routine_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "routine_entries_day_idx" ON "routine_entries" USING btree ("routine_id","staff_id","date");--> statement-breakpoint
CREATE INDEX "routine_entries_date_idx" ON "routine_entries" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "routines_tenant_idx" ON "routines" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_checkin_id_routine_entries_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."routine_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_checkin_idx" ON "calls" USING btree ("checkin_id");