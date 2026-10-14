# Contributing

How to work on ONEHUMAN OS: set up, the daily loop, the rules that are easy to break, and where each kind of change goes. New to the product? Read [How it works](docs/how-it-works.md) first.

## Set up

You need Node 24 (`nvm use`), Docker, and pnpm through Corepack (`corepack enable pnpm`).

```bash
pnpm install
pnpm infra:up                                   # Postgres, Temporal (+ UI on :8233), NATS
cp master-ai-backend/.env.example master-ai-backend/.env
pnpm db:migrate
pnpm dev                                        # shared packages (watch) + API :3000 + worker + web :5173
```

Open http://localhost:5173. No AI key is needed: without one, the platform runs on its built-in rules (*offline mode*).

## The daily loop

- **Run only one `pnpm dev`.** A second one fights the first over port 3000 (its web app lands on :5174).
- **Shared packages are used from their built `dist/`.** `pnpm dev` rebuilds them as you edit. Outside it, run `pnpm build:packages` after changing `packages/`.
- **Before every commit:** `pnpm turbo run build typecheck test`. It must stay green.
- **When you touch what they cover:** `pnpm smoke`, `pnpm e2e:sectors`, `pnpm e2e`, `pnpm e2e:mobile` (see [Testing](docs/testing.md)).
- **Pack YAML:** after editing `packs/`, run `pnpm --filter @onehuman/agent-kit test`.
- **Write tests first.** A bug fix starts with a test that fails because of the bug.

## Rules that are easy to break

**Data and security**
- Every query on a company's data goes through `DbService.tenant(tenantId, tx => …)`. Postgres row-level security keeps companies apart, and the app's database role can't get around it. Only `users` and the `auth_user_tenants()` function are global.
- Every change appends an audit event in the same transaction (`AuditService.append(tx, …)`). Live updates are published after the commit.
- Public routes (the form, the intake API, invites) take the tenant id in the URL and check a hashed key or token under that tenant's security. Don't add global lookups.
- Secrets live in `.env` files, which git ignores. Never commit or paste keys.

**AI and decisions**
- Agents never decide permissions. A new risky tool needs risk metadata in `packages/agent-kit/src/catalog.ts` or a pack alias. Approval rules go in pack `policies`, never in prompts.
- Case gates are policy decisions on `case.proceed` (stage 5) and `case.close` (stage 7), and only the Case coordinator agent holds those tools.
- A model's answer for a stage is checked against its schema and merged under the rules. It never writes to the case directly. Without a valid answer, the built-in rules decide.
- AI providers plug in behind `LlmService` only. Business logic never names a provider or a model.
- Test-set requests (`evals/suites/`) never go into a pack's worked examples.

**What people see**
- Owners and their clients never see tool names, ids or raw data. Use `narrateStep` and `forPeople` (agent-kit), `GoalReport` (reports), and `readableFields` (sdk). Raw data stays on the Audit page.
- Colours come from `@onehuman/ui` tokens (`bg-surface`, `text-fg-muted`, …), never raw values. On mobile, font weights are font families (`font.semibold`), never `fontWeight`.

**Dependencies**
- New dependencies are pinned to a release at least 14 days old.
- There is one React version for the whole repository (Expo's). `motion` is pinned through `overrides` in `pnpm-workspace.yaml`.

The full list, with the reasons, is in [CLAUDE.md](CLAUDE.md).

## Where each kind of change goes

| Change | Where | Then |
|---|---|---|
| A table or column | `master-ai-backend/src/db/schema.ts` | `pnpm --filter @onehuman/backend db:generate`. Add row-level security for new tables in a `_rls.sql` migration, like the existing ones |
| An API route | The module's controller in `master-ai-backend/src/<module>/` | Its request schema goes in `packages/schemas/src/api.ts` and its client call in `packages/sdk/src/client.ts` |
| A workflow step | `master-ai-backend/src/orchestration/` (activities, `workflows.ts`, `case-workflows.ts`) | Add a test; keep workflow code deterministic |
| A new kind of organization | `packs/<id>/pack.yaml` and `evals/suites/<id>.yaml` | Follow the [pack guide](docs/packs.md) and check it with `pnpm pack:check` |
| An agent tool | A pack alias in YAML, or a primitive in `packages/agent-kit/src/catalog.ts` | It needs risk metadata, and the policy tests must cover it |
| A web page | `master-ai-web/src/routes/` plus a route in `main.tsx` | Add it to `src/lib/nav.ts` if it belongs in the menu |
| A phone screen | `master-ai-mobile/src/app/` (Expo Router) | Keep Metro running until the typed routes regenerate |
| A decision others should know | `docs/adr/00NN-….md` | Link it from the README's **Decisions** list (the docs test checks this) |
| Something left for later | [docs/known-gaps.md](docs/known-gaps.md) | One line saying what a person would notice |

## Bigger changes

Larger work starts with a design in `docs/superpowers/specs/` and a task-by-task plan in `docs/superpowers/plans/`, as the 8-stage lifecycle did. Each task ends with its tests passing, and the branch is reviewed as a whole before merging.

## Commits

Keep commits small, and write messages that say what changed and why ("fix(cases): when stage 6's work fails, mark its goal failed…"). Don't push to `main` without the owner's go-ahead.
