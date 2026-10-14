-- A date-time written without a zone offset is India time. Values that carry an offset are unaffected.
CREATE OR REPLACE FUNCTION try_timestamptz(v text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = pg_catalog SET TimeZone = 'Asia/Kolkata' AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
