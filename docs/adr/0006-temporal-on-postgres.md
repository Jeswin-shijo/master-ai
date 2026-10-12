# 0006. Local Temporal runs on Postgres, not the SQLite dev server

Date: 2026-10-12 · Status: accepted

## Context
The single-binary Temporal dev server stores state in SQLite. An abrupt Docker shutdown corrupted it ("database disk image is malformed") and every workflow start failed.

## Decision
Local Temporal uses `temporalio/auto-setup` backed by the stack's Postgres (databases `temporal`, `temporal_visibility`), plus `temporalio/ui` on :8233. Production uses Temporal Cloud or self-hosted Temporal on managed Postgres; that choice is still open.

## Consequences
Local workflows are as durable as in production, and a restart resumes waiting approvals.
