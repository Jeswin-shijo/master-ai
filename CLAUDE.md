@AGENTS.md

# ONEHUMAN OS — working notes

Read `README.md` first. The spec is `docs/architecture-plan.md`; decisions are in `docs/adr/`.

## Commands
- `pnpm infra:up` · `pnpm db:migrate` · `pnpm dev` (packages + API :3000 + worker + web :5173)
- `pnpm turbo run build typecheck test` — must stay green
- `pnpm smoke` — end-to-end against a running API + worker (offline LLM mode); it switches the tenant's calls to auto mode
- `pnpm e2e` — browser tests (Playwright, Chromium) against a running `pnpm dev`: the signup-to-report journey at desktop width, plus a 390px phone project
- `pnpm e2e:mobile` — Maestro flows in Expo Go on the Android emulator (role holder, member, New request). Needs `pnpm dev`, Metro on 8082, the emulator with Expo Go, and Maestro 2.10.0 in `~/.maestro` (`export MAESTRO_VERSION=2.10.0; curl -Ls "https://get.maestro.mobile.dev" | bash`)
- `pnpm e2e:sectors` — every organization type end to end against a running `pnpm dev`: the 15 ready-made types and one typed in the owner's own words per sector. Each invites its role holders and a member, sends a real request through its door (New request, public form or intake API) and checks the gates, the sign-off and that nothing people read names a tool. `--only <id>` runs one. With a model configured it runs one per sector and reports the model's judgement instead of failing on it
- CI's end-to-end job is `infra/ci/e2e.sh` (smoke, `e2e:sectors`, Playwright on the production web build). Rehearse it locally after `pnpm infra:up`, with `pnpm dev` stopped
- `pnpm demo:setup` (once) and `pnpm demo` — the public demo (`infra/demo/demo.mts`): Supabase database from `master-ai-backend/.env.demo`, API + worker on :3100 with Temporal queue `onehuman-demo` (beside `pnpm dev`), a cloudflared quick tunnel, the web app deployed to Vercel against the tunnel. The app role uses Supabase's transaction pooler (6543); setup revokes Supabase's `anon`/`authenticated` roles from the public schema
- Run only one `pnpm dev`. A second one fights the first over :3000 and keeps crashing the API (its web lands on :5174).
- New migration: edit `master-ai-backend/src/db/schema.ts`, then `pnpm --filter @onehuman/backend db:generate`

## Rules that are easy to break
- Every tenant-scoped query goes through `DbService.tenant(tenantId, tx => …)`. RLS is enforced by Postgres; the app role cannot bypass it. Only `users` and the `auth_user_tenants()` function are global.
- Every state change appends an audit event inside the same transaction (`AuditService.append(tx, …)`). Realtime events publish after commit.
- Agents never decide permissions: new risky tools need risk metadata in `packages/agent-kit/src/catalog.ts` or a pack alias, and approval rules belong in pack `policies`, not prompts.
- Case gates are policies on `case.proceed` (stage 5) and `case.close` (the stage 7 sign-off). Only the Case coordinator agent holds those tools. A category's approval and sign-off rules compile to pack policies (`lifecycle.<category>.approve` / `.signoff`); never decide a gate in code or in a prompt ([ADR 0009](docs/adr/0009-organization-types-and-the-case-lifecycle.md)).
- Public routes take the tenant id in the URL (`/intake/:tenantId/…`, `/invites/:tenantId/:token`) and check a hashed key or token under that tenant's RLS. Don't add a global lookup or a security-definer function for them ([ADR 0010](docs/adr/0010-roles-invites-and-gate-approvals.md)).
- Stage outputs are zod-validated case-file parts. A model's answer is parsed with `MODEL_STAGE_SCHEMAS` (one repair round), then merged under the rules (`mergeReview`, `mergeClassify`, …) into the typed `CaseFile` part (`packages/schemas/src/case.ts`). A model answer never writes the case file or case columns directly; without a valid answer the offline strategy decides.
- Eval requests never go into pack `lifecycle.examples`: examples teach the model, evals test it. `evals/src/suites.test.ts` fails if one does.
- Model providers plug in behind `LlmService` only. Claude is the default; Gemini (`GEMINI_API_KEY`, `LLM_PROVIDER`) is optional, and its request/response mapping lives in `packages/agent-kit/src/gemini.ts` so `pnpm evals:live` shares it. Business logic never names a provider or a model ([ADR 0011](docs/adr/0011-gemini-as-a-second-model-provider.md)).
- `LLM_OFFLINE=always` in the shell beats the `.env` file (`config.ts` loads it without overriding). CI and offline checks use it so a key in `.env` can't change their results. `pnpm dev` gets it through turbo's strict env mode only because `turbo.json` lists it in the dev task's `passThroughEnv`; a new variable a dev process must read from the shell needs the same.
- Pack YAML is validated by `packages/agent-kit/src/pack.test.ts`. Run it after editing `packs/`.
- Workspaces store a snapshot of their pack. Base-pack additions reach existing workspaces only through the update banner (`packUpdates` → `POST /workspaces/:id/updates`), which adds and never replaces.
- One React version repo-wide (Expo's). Don't bump React in web alone.
- Work done by people goes through `staff.delegate` and `delegationWorkflow` (`master-ai-backend/src/voice/`). Real telephony must plug in behind `DelegationService.placeCall` and reuse `answer`/`reply`/`decline`; don't fork the call flow ([ADR 0007](docs/adr/0007-phone-delegation-to-staff.md)).
- Real calls (Twilio) arrive as public webhooks under `/voice/twilio/*`. They must stay `@Public()`, verify `X-Twilio-Signature` against `PUBLIC_URL` + the original URL, and answer with TwiML even on errors. To test without Twilio, point `TWILIO_API_URL` at a fake server and give the test API and worker their own `TEMPORAL_TASK_QUEUE`.
- Calls have one owner: `CallsService` (answer/reply/decline/list) passes each to `DelegationService` or `RoutinesService` by `delegation_id` / `checkin_id`. New call purposes plug in there, not in the controllers ([ADR 0008](docs/adr/0008-routines-manual-or-automatic.md)).
- Routine schedules are Temporal Schedules (`routine-<id>`), kept in step by `RoutinesService` on create/update. In pack YAML, quote question text that contains commas (`ask: "…, …?"`); `pack.test.ts` checks every `ask` ends with "?".
- Animations use `motion` (pinned with its own packages via `overrides` in pnpm-workspace.yaml); the shell wraps everything in `MotionConfig reducedMotion="user"`. Shared pieces live in `master-ai-web/src/components/motion.tsx`.
- `RealtimeGateway` closes WebSocket and SSE connections on shutdown. Without that, `node --watch` restarts of the API hang while a browser is open.
- Owners and their clients never see tool names, ids or JSON. Describe steps with `narrateStep` (agent-kit), goals with `GoalReport` (`ReportsService`), and action details with `readableFields` (sdk). Raw data stays in the Audit page.
- Colours come from `@onehuman/ui` tokens (dark-first, n8n style). Use the token classes (`bg-surface`, `text-fg-muted`, `bg-canvas`, …), not raw Tailwind colours.
- Shared packages are consumed from `dist/`. Rebuild them (`pnpm build:packages`) or run `pnpm dev`, which watches.
- The session token never goes in a URL. WebSockets and SSE open with a one-minute stream ticket (`POST /auth/stream-ticket`, `issueStreamTicket`/`readStreamTicket`); a ticket can't call the API and a session token in a query string is refused.
- The browser takes run-time values from `@onehuman/schemas/plain` (zod-free), never the package root; types come from the root with `import type`. Web pages are lazy routes in `main.tsx`. `master-ai-web/src/bundle.test.ts` checks both.
- How the web build is served (CSP, framing, caching, noindex on keyed links) lives in `master-ai-web/src/hosting.ts`; `pnpm demo` writes it to `vercel.json` and `vite preview` serves it in CI. A new service the page calls goes in its `connect-src`.
- Sign-in, sign-up and the public routes are rate limited in process (`RateLimiter`, `SignInLimits`). More than one API process needs a shared store first. What's left before going live is in `docs/production-readiness.md`.

## Mobile gotchas
- Port 8081 may be taken locally; the `start` script uses 8082.
- The app is always dark (`src/lib/theme.ts`). Don't go back to `useColorScheme()`: Expo Go reports the phone's scheme and ignores `userInterfaceStyle` in app.json.
- `CI=1 expo start` disables Metro's file watching. Restart with `--clear` to see code changes.
- In Expo Go on Android, evaluating `expo-notifications` throws (push removed in SDK 53). `src/lib/push.ts` requires it lazily; keep it that way.
- Android emulator: run `adb reverse tcp:3000 tcp:3000` and open `exp://127.0.0.1:8082` so the app reaches the API.
- Weights are font families (`font.semibold`, …), never `fontWeight`: Android drops a custom font when `fontWeight` is set. `tests/tokens.test.ts` enforces it, along with no hex or named colours.
- New routes need fresh typed routes: keep Metro running until `.expo/types/router.d.ts` regenerates, then typecheck.
- The Maestro flows run with Android's animations off (`run.mts` restores them): a screen that never stops animating (the live stage) can't be read by UI Automator.
