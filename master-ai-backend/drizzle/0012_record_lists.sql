ALTER TABLE "records" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "source_ref" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "updated_via" text;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "updated_ref" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "checked_by" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "check_note" text;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "checked_problems" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "records_source_idx" ON "records" USING btree ("tenant_id","workspace_id","entity","source");