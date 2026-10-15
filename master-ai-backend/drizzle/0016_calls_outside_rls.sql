-- Notes, follow-up switches and attempts, and the do-not-call list get the same tenant isolation as everything else.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['record_notes', 'follow_up_switches', 'follow_up_attempts', 'do_not_call'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO onehuman_app', t);
  END LOOP;
END $$;
