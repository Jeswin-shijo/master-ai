# Testing

There are six kinds of test, from fast checks on code to full runs through the real apps. All of them run in *offline mode* (no AI key, built-in rules), so their results are the same every time. A separate live run checks the real model path.

## At a glance

| Command | What it proves | Needs | Time |
|---|---|---|---|
| `pnpm turbo run build typecheck test` | Everything builds and type-checks, and every package's unit tests pass. That includes the scored test sets and the docs check | Nothing running | ~1–2 min |
| `pnpm evals` | The 16 test sets, with a scorecard per organization type | Nothing running | seconds |
| `pnpm coverage` | Every package's unit tests in one run, with one coverage report (`coverage/index.html`) | Nothing running | ~1 min |
| `pnpm test:integration` | The backend's services on a real database with row-level security: tenant isolation, invites, sign-in, the audit chain, the public form and intake API, the stage service, and lists with their checks | `pnpm infra:up` | ~10 s |
| `pnpm smoke` | The whole platform end to end through the API. One organization per sector runs a case through all 8 stages, then the edge cases | `pnpm dev` | ~4 min |
| `pnpm e2e:sectors` | Every organization type end to end: the 15 ready-made types and one typed in the owner's own words per sector | `pnpm dev` | ~3 min |
| `pnpm e2e` | The web app in a real browser (Playwright): Chromium at desktop and phone widths, and the main path in Firefox and WebKit | `pnpm dev` | ~2 min |
| `pnpm e2e:mobile` | The phone app in Expo Go on the Android emulator (Maestro) | `pnpm dev`, Metro, the emulator | ~5 min |

Run the first line before every commit. Run the others when you touch what they cover.

## Where tests live

Each app and package keeps its tests in one `__tests__/` folder, never next to the code:

| Section | Folder |
|---|---|
| `master-ai-backend` | `__tests__/unit/` (mirrors `src/`), `__tests__/integration/` |
| `master-ai-web` | `__tests__/unit/` (mirrors `src/`), `__tests__/e2e/` |
| `master-ai-mobile` | `__tests__/unit/`, `__tests__/e2e/` (Maestro flows and their runner) |
| `packages/*`, `evals` | `__tests__/` (mirrors `src/`) |

Each `__tests__/` has its own `tsconfig.json`, and the section's `typecheck` runs it, so tests are type-checked like the code.

## Unit tests

Every package has its own (`pnpm --filter <package> test`):

- **`packages/agent-kit`** checks:
  - that all 25 packs parse, resolve and validate, and that worked examples stay out of the test sets;
  - the offline stage rules, the AI prompts, the Gemini mapping and plain-words narration.
- **`packages/policy`**: risk scores and Cedar decisions.
- **`packages/sdk`**: signing, readable fields, the case views and report shared by web and mobile, and the live connection's tickets and reconnects.
- **`packages/schemas`**: the input rules people meet (sign-up, a request, the public form, intake keys, invites), the plain values the apps show, and the canonical JSON behind audit hashes and signatures.
- **`packages/ui`**: colour contrast of the design tokens.
- **`master-ai-backend`** covers:
  - who may decide an approval, invite rules, intake keys, cases and gates;
  - the rate limiter, the rules fallback, the choice of AI provider, and Twilio signatures;
  - the call engines and their helpers: `spoken` (Indian amounts and dates), `collect-engine`, `follow-up-engine`, `hours`, `due-sql` and `targets`.
- **`master-ai-web`**: navigation, people and the design-token guard.
- **`master-ai-mobile`**: design tokens, sessions, offline approvals, and the badge.
- **`evals`** covers:
  - the test sets themselves, and the checks the sector run applies;
  - the live scorer's error handling;
  - `docs.test.ts`, which keeps the docs honest: links resolve, every decision record and root command is listed, and every organization type is named.

## Integration specs (backend)

`pnpm test:integration` runs `master-ai-backend/__tests__/integration/*.spec.ts`. They boot the API's real modules the way the worker does, on a fresh `onehuman_test` database that the run creates beside the dev database and migrates. The services connect as `onehuman_app`, so row-level security applies as in production. Temporal is replaced by a recorder, so a spec calls the workflow's activities itself, in the workflow's order, and checks what the services asked Temporal to do. The AI is offline.

| Spec | What it proves |
|---|---|
| `tenant-isolation` | Every table with a `tenant_id` has row-level security and the tenant policy (read from the catalog, so a new table without it fails); the app role can't bypass it; a company can't read or write another's rows |
| `invites` | A link opens and joins only its own company, is stored as a hash, works once, and stops when withdrawn, expired or its admin is removed |
| `identity` | Sign-up, sign-in (same answer for a wrong password and an unknown email, the lock after 10 wrong tries), picking and switching companies |
| `audit-chain` | Concurrent changes get one gap-free chain; a rolled-back change leaves no line; edits are refused, and one made around the guards is found |
| `intake` | The public form and intake API: own company only, withdrawn keys, the kill switch, repeated `externalRef` (even two at once), keys kept as hashes |
| `stages` | The stage service: a job through all 8 stages with signed decisions by the role holder, a refused permit, an expired decision, failed work, the kill switch |
| `record-sources` | How every item came in (by hand, agent, sample) and who checked it; an agent's change clears the check and is audited with old and new values; the backfill; numbers and dates that aren't valid read as blank; `try_timestamptz` reads a date-time without an offset as India time |
| `lists` | Each kind of check against real rows (adds up, missing, not found, duplicate pair, overdue in India days, limits, expiring); totals over every match, not one page; date ranges, filters, how items came in; search taken literally, matching values and party names (not field names or ids); date-times without an offset as India time; old snapshots; another company's items; CSV without ids |
| `lists-writes` | Adding as the owner (checked), correcting (history with old and new values), checking with a note when problems are open, an accepted problem versus a new one, bulk checking that skips problems and ignores others' ids, removing with a copy kept, removing sample data |
| `sector-lists` | All 15 types: every list opens with each view, sort and filter, and downloads; an older company gets new record types and lists from the update banner |
| `calls-outside` | A call to an outside party lists with its contact and item; a call with nobody to call is refused |
| `notes` | Notes from calls show on the item, its card and New from calls; Apply sets the fields and checks the item; Seen; a waiting follow-up starts again; another company's notes stay hidden; items say which call they came from |
| `collection` | A collection call adds items from what a clerk reads out (source call, not checked), keeps confirmed items when the call drops, notes a difference instead of adding a repeat, counts items added by hand, and runs in the simulator's auto mode |
| `follow-ups` | Owner-only switches for parties and the schedule; picking due items one at a time and skipping do-not-call, not-yet-due, waiting and noted items; a missing phone or unknown team member stops with a note; hours, the daily cap and the kill switch; a promise, a paid answer the head applies, a wrong number, three unanswered calls, auto mode; a team member's answer updating the item; a planned call re-checked just before it rings (paused, switched off, do-not-call); sample items never called; a retried call never closes a live one |

Write a new one with `boot()` and `newOrg()` from `__tests__/integration/harness.ts`. Each file gets its own organizations, so files don't depend on each other. CI runs them in the e2e job, where Postgres is up.

## Coverage

`pnpm coverage` runs every package's unit tests in one go (the root `vitest.config.mts` lists them as vitest projects) and writes `coverage/index.html`. `pnpm test:integration --coverage` does the same for the backend's integration specs, in `coverage/integration/`. Unit tests cover the shared packages well (policy, agent kit, SDK). The web and phone apps, and the backend's database services, are covered by the integration specs and the browser and phone tests rather than unit tests, so their unit numbers are low by design.

## Test sets (evals)

Each ready-made type has about 10 realistic requests, written the way people really send them. Each request comes with the answers each stage should give: category, priority, review outcome, approval and sign-off. `pnpm evals` scores the built-in rules and fails below these floors: category 90%, priority 90%, review 80%, gates 100%. See [evals/README.md](../evals/README.md).

`pnpm evals:live [--pack <id>] [--rpm <n>]` scores the same sets with a real model (Claude, or Gemini) and prints the cost. Use `--rpm` with a free key.

## End-to-end runs

These scripts live in `master-ai-backend/scripts/` and talk to a running API exactly as the apps do.

- **`pnpm smoke`** checks:
  - signup and installing a pack; a goal and its plan; a signed approval (a forged signature is refused);
  - that changes show up live, that the audit chain verifies, and that each organization's data stays apart;
  - the kill switch, and phone delegation.

  Then one organization per sector runs a case through all 8 stages, followed by the edge cases: public form, intake API, needs details, cancel, rejected gate, not eligible, invites, refusals, removal and demotion.
- **`pnpm e2e:sectors`** sets up all 20 organizations, five sectors in parallel. Each one invites its role holders and a member, then sends a real request from its test set through the door it would really use. It then checks:
  - the stage names;
  - the category and priority;
  - who approved and who signed off, and that the member was refused;
  - that nothing people read shows a tool name, an id or raw data.

  Use `--only <id>` to run a single organization. With a model configured (`GET /health` says `online`), it runs one organization per sector, one at a time, and reports where the model's judgement differs from the test set instead of failing.
- **`pnpm e2e`** runs the Playwright tests in `master-ai-web/__tests__/e2e/`. They cover signup to report in the browser at 1440 px (sector, type, preview, install, a new request, stages advancing live, approval by the role holder in a second browser, sign-off, the report), plus the main pages at 390 px phone width. `pages.spec.ts` opens every menu page as the owner and as a member: a heading, its tab title, no page errors, and no ids or tool names in what people read. `features.spec.ts` covers the kill switch, Knowledge, and Team with an automatic check-in. `lists.spec.ts` is the head's journey, at desktop and 390 px phone width: a bill that doesn't add up is found, bills are filtered to unpaid this month with the exact total checked, the problem is accepted with a note, the bill is corrected (its history shows the old and new values) and the list downloaded as CSV. `list-calls.spec.ts` (a collection call and a follow-up the head applies, desktop) and `collect-by-hand.spec.ts` (bills added by hand count for the right person, even when the form is closed without Done; desktop). `browsers.spec.ts` runs the main path (sign-up, a live request, the report, Copy, the print view) in Chromium, Firefox and WebKit, and fails on any page error or blocked script. Install the browsers once with `pnpm --filter @onehuman/web exec playwright install chromium firefox webkit`. On macOS 27.0.1 Playwright's Firefox doesn't start ("Could not find profile folder"); run `pnpm e2e --project=desktop --project=webkit` there, and CI covers Firefox.
- **`pnpm e2e:mobile`** runs the Maestro flows in `master-ai-mobile/__tests__/e2e/`: a role holder approves with the fingerprint-signed key, a member sees no approvals, and a new request from the phone runs its stages. Setup is in [master-ai-mobile/README.md](../master-ai-mobile/README.md#testing).

## CI

GitHub Actions ([ci.yml](../.github/workflows/ci.yml)) runs two jobs on every push:

1. **checks**: `pnpm turbo run build typecheck test`.
2. **e2e**: starts Postgres, Temporal and NATS, then runs [infra/ci/e2e.sh](../infra/ci/e2e.sh). The script builds, starts the API, worker and production web build (always offline), and runs the smoke test, the sector run and the browser tests. The production build is served with the same security headers it is hosted with (`master-ai-web/src/hosting.ts`), so a script or connection the content security policy blocks fails the browser tests.

To rehearse the e2e job locally, run `pnpm infra:up`, stop `pnpm dev`, then `bash infra/ci/e2e.sh`. Where Playwright's Firefox can't start, run `E2E_ARGS='--project=desktop --project=phone --project=webkit' bash infra/ci/e2e.sh`.

## Offline vs live

`LLM_OFFLINE=always` in the shell keeps a stack offline even when `master-ai-backend/.env` has a key. CI and the rehearsal use it. To check the real model path, start `pnpm dev` with a key and run `pnpm evals:live` and `pnpm e2e:sectors`. Findings from those runs go to [known gaps](known-gaps.md) when they are the model's judgement, or get fixed with a test when they are our code.
