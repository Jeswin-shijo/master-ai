ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_token_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_tenant_token_idx" ON "push_tokens" USING btree ("tenant_id","token");