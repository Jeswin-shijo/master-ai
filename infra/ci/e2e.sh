#!/usr/bin/env bash
# CI's end-to-end job, runnable locally the same way. Builds, migrates, runs the
# backend's integration specs, starts the API, the worker and the production web
# build, then runs the smoke test, every organization type, and the browser tests. Always in offline LLM mode,
# even when the .env has a key, so results are deterministic. Needs Postgres,
# Temporal and NATS (`pnpm infra:up`) and nothing else on :3000 or :5173, so
# stop `pnpm dev` first.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOGS=${LOGS:-$PWD/.ci-logs}
mkdir -p "$LOGS"
# The shell wins over the .env file (config.ts loads it without overriding).
export LLM_OFFLINE=always

for port in 3000 5173; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Something is already listening on :$port. Stop \`pnpm dev\` first." >&2
    exit 1
  fi
done

pnpm turbo run build --filter=@onehuman/backend... --filter=@onehuman/web...
[ -f master-ai-backend/.env ] || cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate
# The backend's integration specs make their own database (onehuman_test) on the same Postgres.
pnpm test:integration

stop() {
  for port in 3000 5173; do
    pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  [ -n "${worker:-}" ] && kill "$worker" 2>/dev/null || true
}
trap stop EXIT

(cd master-ai-backend && exec node --enable-source-maps dist/main.js) >"$LOGS/api.log" 2>&1 &
(cd master-ai-backend && exec node --enable-source-maps dist/worker.js) >"$LOGS/worker.log" 2>&1 &
worker=$!
pnpm --filter @onehuman/web preview --port 5173 --strictPort >"$LOGS/web.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf localhost:3000/health >/dev/null && curl -sf localhost:5173 >/dev/null && break
  sleep 1
done
curl -sf localhost:3000/health >/dev/null || { echo "The API did not start:"; tail -n 50 "$LOGS/api.log"; exit 1; }
curl -sf localhost:5173 >/dev/null || { echo "The web app did not start:"; tail -n 50 "$LOGS/web.log"; exit 1; }

pnpm smoke
pnpm e2e:sectors
# E2E_ARGS narrows the browser tests, e.g. --project=desktop --project=phone --project=webkit
# where Playwright's Firefox can't start (macOS 27.0.1).
pnpm e2e ${E2E_ARGS:-}
