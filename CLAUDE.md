@AGENTS.md

# ONEHUMAN OS — working notes

Read `README.md` first. The spec is `docs/architecture-plan.md`; decisions are in `docs/adr/`.

## Commands
- `pnpm infra:up` · `pnpm db:migrate` · `pnpm dev` (packages + API :3000 + worker + web :5173)
- `pnpm turbo run build typecheck test` — must stay green
- `pnpm smoke` — end-to-end against a running API + worker (offline LLM mode); it switches the tenant's calls to auto mode
- `pnpm e2e` — browser tests (Playwright, Chromium) against a running `pnpm dev`: the signup-to-report journey at desktop width, plus a 390px phone project
- `pnpm e2e:mobile` — Maestro flows in Expo Go on the Android emulator (role holder, member, New request). Needs `pnpm dev`, Metro on 8082, the emulator with Expo Go, and Maestro 2.10.0 in `~/.maestro` (`export MAESTRO_VERSION=2.10.0; curl -Ls "https://get.maestro.mobile.dev" | bash`)
- Run only one `pnpm dev`. A second one fights the first over :3000 and keeps crashing the API (its web lands on :5174).
- New migration: edit `master-ai-backend/src/db/schema.ts`, then `pnpm --filter @onehuman/backend db:generate`

## Rules that are easy to break
- Every tenant-scoped query goes through `DbService.tenant(tenantId, tx => …)`. RLS is enforced by Postgres; the app role cannot bypass it. Only `users` and the `auth_user_tenants()` function are global.
- Every state change appends an audit event inside the same transaction (`AuditService.append(tx, …)`). Realtime events publish after commit.
- Agents never decide permissions: new risky tools need risk metadata in `packages/agent-kit/src/catalog.ts` or a pack alias, and approval rules belong in pack `policies`, not prompts.
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

## Mobile gotchas
- Port 8081 may be taken locally; the `start` script uses 8082.
- The app is always dark (`src/lib/theme.ts`). Don't go back to `useColorScheme()`: Expo Go reports the phone's scheme and ignores `userInterfaceStyle` in app.json.
- `CI=1 expo start` disables Metro's file watching. Restart with `--clear` to see code changes.
- In Expo Go on Android, evaluating `expo-notifications` throws (push removed in SDK 53). `src/lib/push.ts` requires it lazily; keep it that way.
- Android emulator: run `adb reverse tcp:3000 tcp:3000` and open `exp://127.0.0.1:8082` so the app reaches the API.
- Weights are font families (`font.semibold`, …), never `fontWeight`: Android drops a custom font when `fontWeight` is set. `tests/tokens.test.ts` enforces it, along with no hex or named colours.
- New routes need fresh typed routes: keep Metro running until `.expo/types/router.d.ts` regenerates, then typecheck.
- The Maestro flows run with Android's animations off (`run.mts` restores them): a screen that never stops animating (the live stage) can't be read by UI Automator.
