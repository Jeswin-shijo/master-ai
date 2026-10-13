-- Invites get the same tenant isolation as everything else.
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invites USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invites TO onehuman_app;
