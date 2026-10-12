-- Team directory, delegations and calls get the same tenant isolation as everything else.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff', 'delegations', 'calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO onehuman_app', t);
  END LOOP;
END $$;
