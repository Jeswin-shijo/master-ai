-- Runs once when the volume is created.
-- The API and workers connect as onehuman_app, which is NOT the table owner and
-- has no BYPASSRLS, so row-level security applies to every query.
CREATE ROLE onehuman_app LOGIN PASSWORD 'onehuman_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE onehuman TO onehuman_app;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
