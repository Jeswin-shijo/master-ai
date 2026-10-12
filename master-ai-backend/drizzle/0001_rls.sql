-- Tenant isolation inside the database.
--
-- The API and workers connect as onehuman_app (created in infra/docker/postgres/init.sql),
-- which does not own these tables and has no BYPASSRLS. Every request runs in a
-- transaction that sets app.tenant_id; the policies below hide every other tenant's rows.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'principals', 'workspaces', 'pack_drafts', 'agents', 'autonomy_overrides', 'policies',
    'goals', 'tasks', 'tool_calls', 'approval_requests', 'device_keys', 'push_tokens',
    'records', 'outbox', 'knowledge_docs', 'knowledge_chunks', 'llm_calls',
    'audit_events', 'audit_heads'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
--> statement-breakpoint

-- Grants for the app role. The audit log is append-only: no UPDATE or DELETE.
GRANT USAGE ON SCHEMA public TO onehuman_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO onehuman_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM onehuman_app;
--> statement-breakpoint
REVOKE DELETE ON users FROM onehuman_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO onehuman_app;
--> statement-breakpoint

-- Belt and braces: even the owner cannot rewrite history.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint

-- Login needs to find a user's tenants before a tenant is selected. This one
-- narrow function runs as the owner and returns only that user's memberships.
CREATE OR REPLACE FUNCTION auth_user_tenants(p_user_id uuid)
  RETURNS TABLE (tenant_id uuid, tenant_name text, principal_id uuid, role text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT t.id, t.name, p.id, p.role
    FROM principals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.user_id = p_user_id AND p.kind = 'human' AND p.status = 'active'
    ORDER BY t.created_at
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_user_tenants(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_user_tenants(uuid) TO onehuman_app;
