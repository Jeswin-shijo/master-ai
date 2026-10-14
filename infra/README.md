# infra

Everything around the apps: the local stack, CI's end-to-end script, and the public demo runner.

## `docker/`: the local stack

`pnpm infra:up` starts it, and `pnpm infra:down` stops it (`docker-compose.yml`, project `onehuman`):

| Service | Image | Port | What it is |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | 5432 | The app's database. On first start, `postgres/init.sql` creates the app role `onehuman_app` (no `BYPASSRLS`) and the `vector` and `citext` extensions |
| `temporal` | `temporalio/auto-setup:1.29.7` | 7233 | The workflow engine. It persists to the same Postgres, so workflows survive restarts ([decision 0006](../docs/adr/0006-temporal-on-postgres.md)) |
| `temporal-ui` | `temporalio/ui:2.55.0` | 8233 | See every workflow, its history and its failures at http://localhost:8233 |
| `nats` | `nats:2.11-alpine` | 4222 (8222 monitoring) | The event bus (JetStream). Audit events stream from it to the apps |

In production these become managed services (a managed Postgres, Temporal Cloud or a Temporal cluster, a NATS cluster).

## `ci/e2e.sh`: CI's end-to-end job

The same script runs in GitHub Actions and on your machine. It:

1. builds the backend and the web app, and runs the migrations;
2. starts the API, the worker and the **production** web build (`vite preview` on 5173), always in offline mode (`LLM_OFFLINE=always`, even if `.env` has a key);
3. runs `pnpm smoke`, `pnpm e2e:sectors` and `pnpm e2e`;
4. stops what it started, even on failure.

Logs go to `.ci-logs/` (or `$LOGS`). To rehearse it locally, run `pnpm infra:up`, stop `pnpm dev` (the script refuses busy ports), then `bash infra/ci/e2e.sh`.

## `demo/demo.mts`: the public demo

`pnpm demo:setup` (once) and `pnpm demo` put the app online:
- the database is on Supabase;
- the API and worker run on this machine, beside `pnpm dev` (port 3100, Temporal queue `onehuman-demo`);
- a Cloudflare quick tunnel gives the API a public address;
- the web app is on Vercel.

Step by step: [docs/demo.md](../docs/demo.md).
