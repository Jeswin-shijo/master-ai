# Testing

There are six kinds of test, from fast checks on code to full runs through the real apps. All of them run in *offline mode* (no AI key, built-in rules), so their results are the same every time. A separate live run checks the real model path.

## At a glance

| Command | What it proves | Needs | Time |
|---|---|---|---|
| `pnpm turbo run build typecheck test` | Everything builds and type-checks, and every package's unit tests pass. That includes the scored test sets and the docs check | Nothing running | ~1–2 min |
| `pnpm evals` | The 16 test sets, with a scorecard per organization type | Nothing running | seconds |
| `pnpm smoke` | The whole platform end to end through the API. One organization per sector runs a case through all 8 stages, then the edge cases | `pnpm dev` | ~4 min |
| `pnpm e2e:sectors` | Every organization type end to end: the 15 ready-made types and one typed in the owner's own words per sector | `pnpm dev` | ~3 min |
| `pnpm e2e` | The web app in a real browser (Playwright): Chromium at desktop and phone widths, and the main path in Firefox and WebKit | `pnpm dev` | ~2 min |
| `pnpm e2e:mobile` | The phone app in Expo Go on the Android emulator (Maestro) | `pnpm dev`, Metro, the emulator | ~5 min |

Run the first line before every commit. Run the others when you touch what they cover.

## Unit tests

Every package has its own (`pnpm --filter <package> test`):

- **`packages/agent-kit`** checks:
  - that all 25 packs parse, resolve and validate, and that worked examples stay out of the test sets;
  - the offline stage rules, the AI prompts, the Gemini mapping and plain-words narration.
- **`packages/policy`**: risk scores and Cedar decisions.
- **`packages/sdk`**: signing, readable fields and the case views shared by web and mobile.
- **`packages/ui`**: colour contrast of the design tokens.
- **`master-ai-backend`** covers:
  - who may decide an approval, invite rules, intake keys, cases and gates;
  - the rate limiter, the rules fallback, the choice of AI provider, and Twilio signatures.
- **`master-ai-web`**: navigation, people and the design-token guard.
- **`master-ai-mobile`**: design tokens, sessions, offline approvals, and the badge.
- **`evals`** covers:
  - the test sets themselves, and the checks the sector run applies;
  - the live scorer's error handling;
  - `docs.test.ts`, which keeps the docs honest: links resolve, every decision record and root command is listed, and every organization type is named.

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
- **`pnpm e2e`** runs the Playwright tests in `master-ai-web/e2e/`. They cover signup to report in the browser at 1440 px (sector, type, preview, install, a new request, stages advancing live, approval by the role holder in a second browser, sign-off, the report), plus the main pages at 390 px phone width. `e2e/browsers.spec.ts` runs the main path (sign-up, a live request, the report, Copy, the print view) in Chromium, Firefox and WebKit, and fails on any page error or blocked script. Install the browsers once with `pnpm --filter @onehuman/web exec playwright install chromium firefox webkit`. On macOS 27.0.1 Playwright's Firefox doesn't start ("Could not find profile folder"); run `pnpm e2e --project=desktop --project=webkit` there, and CI covers Firefox.
- **`pnpm e2e:mobile`** runs the Maestro flows in `master-ai-mobile/e2e/`: a role holder approves with the fingerprint-signed key, a member sees no approvals, and a new request from the phone runs its stages. Setup is in [master-ai-mobile/README.md](../master-ai-mobile/README.md#testing).

## CI

GitHub Actions ([ci.yml](../.github/workflows/ci.yml)) runs two jobs on every push:

1. **checks**: `pnpm turbo run build typecheck test`.
2. **e2e**: starts Postgres, Temporal and NATS, then runs [infra/ci/e2e.sh](../infra/ci/e2e.sh). The script builds, starts the API, worker and production web build (always offline), and runs the smoke test, the sector run and the browser tests. The production build is served with the same security headers it is hosted with (`master-ai-web/src/hosting.ts`), so a script or connection the content security policy blocks fails the browser tests.

To rehearse the e2e job locally, run `pnpm infra:up`, stop `pnpm dev`, then `bash infra/ci/e2e.sh`. Where Playwright's Firefox can't start, run `E2E_ARGS='--project=desktop --project=phone --project=webkit' bash infra/ci/e2e.sh`.

## Offline vs live

`LLM_OFFLINE=always` in the shell keeps a stack offline even when `master-ai-backend/.env` has a key. CI and the rehearsal use it. To check the real model path, start `pnpm dev` with a key and run `pnpm evals:live` and `pnpm e2e:sectors`. Findings from those runs go to [known gaps](known-gaps.md) when they are the model's judgement, or get fixed with a test when they are our code.
