CREATE INDEX "approvals_goal_idx" ON "approval_requests" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "approvals_task_idx" ON "approval_requests" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "delegations_goal_idx" ON "delegations" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "device_keys_principal_idx" ON "device_keys" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_doc_idx" ON "knowledge_chunks" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "push_tokens_principal_idx" ON "push_tokens" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "staff_principal_idx" ON "staff" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "tool_calls_goal_idx" ON "tool_calls" USING btree ("goal_id","created_at");--> statement-breakpoint
-- Supabase's linter flags functions whose search_path a caller could change.
-- current_tenant_id() is left as it is: a SET clause would stop Postgres
-- inlining it into every RLS policy, and it only calls pg_catalog functions,
-- which are always looked up first.
ALTER FUNCTION audit_events_immutable() SET search_path = pg_catalog;
