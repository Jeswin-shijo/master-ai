-- Values read from a record's JSON for list checks, totals and sorting. Anything that is not a
-- valid number or date reads as null (blank), so one bad value can never break a list.
CREATE OR REPLACE FUNCTION try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\s*-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$' THEN RETURN NULL; END IF;
  RETURN v::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION try_date(v text) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN left(v, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION try_timestamptz(v text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION try_numeric(text), try_date(text), try_timestamptz(text) TO onehuman_app;
--> statement-breakpoint
-- How items saved before this came in. Sample items were seeded in the install transaction,
-- so they share the workspace's created_at (now() is the transaction's start time).
UPDATE records r SET source = 'sample' FROM workspaces w WHERE w.id = r.workspace_id AND r.created_at = w.created_at;
--> statement-breakpoint
-- Items an AI agent added say so in the audit trail.
UPDATE records r SET source = 'agent'
  FROM audit_events e
  WHERE e.ref_id = r.id AND e.type = 'record.created' AND e.actor_kind = 'agent' AND r.source = 'manual';
