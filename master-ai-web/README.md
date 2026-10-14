# master-ai-web

The web app owners and their teams use: React 19, Vite, Tailwind 4, TanStack Query and `motion`, in the dark "Glow" look (violet-navy, warm orange actions; inspired by n8n.io). It talks to the API through the typed client in `@onehuman/sdk`.

## Running it

`pnpm dev` from the repository root serves it on http://localhost:5173 with the API on :3000. On its own:

| Script | What it does |
|---|---|
| `pnpm --filter @onehuman/web dev` | Vite dev server |
| `… build` | Type-check, then build to `dist/` |
| `… preview` | Serve the built `dist/` (CI's browser tests run against this) |
| `… test` | Unit tests (vitest) |
| `… e2e` | Playwright browser tests (`pnpm e2e` from the root) |

The API address comes from `VITE_API_URL` at build time (default `http://localhost:3000`).

## Pages (`src/routes/`)

| Path | File | What it is |
|---|---|---|
| `/login`, `/signup` | `auth.tsx` | Sign in; set up an organization (sector, type, account) |
| `/onboarding` | `onboarding.tsx` | Preview the pack (stages, kinds of request, roles, agents, records) and install it |
| `/` | `home.tsx` | Home: what needs you, today's cases, routines and New request |
| `/cases`, `/cases/:id` | `cases.tsx`, `case.tsx` | The case list with each case's 8 stage dots; one case on an animated canvas, with its case file in sentences and its report |
| `/approvals` | `approvals.tsx` | The inbox (*Mine*, or *All* for owners and admins); signed approve or reject |
| `/team` | `team.tsx` | Members, invites, access and approver roles, and the team directory (staff the AI can phone) |
| `/reports` | `reports.tsx` | Case and goal reports by period: copy, print, share |
| `/routines`, `/routines/:id` | `routines.tsx` | Daily check-ins, by hand or by phone, with a live board |
| `/calls` | `calls.tsx` | Phone calls to staff, with transcripts |
| `/goals/:id` | `goal-detail.tsx` | A goal's plan on a node canvas, step by step |
| `/workflows` | `workflows.tsx` | The workflows the pack offers, ready to start as a request |
| `/agents`, `/records`, `/knowledge`, `/pack` | | Agents and their autonomy; the pack's records; playbooks; the installed pack and its updates |
| `/audit` | `audit.tsx` | The audit log: verify the chain, replay a goal (raw data lives only here) |
| `/settings` | `settings.tsx` | Theme, phone calls, request keys (form link, API keys) and privacy (PII redaction). The kill switch, which pauses every agent, is in the shell's header |
| `/invite/:tenantId/:token` | `invite.tsx` | Accept an invite |
| `/r/:tenantId/:key` | `public-form.tsx` | The public request form customers use (no login) |

Owner- and admin-only pages are hidden from members (`src/lib/nav.ts`), and the API refuses their actions anyway.

## Code layout

- `src/components/`: the shared pieces:
  - `app-shell`: the layout, navigation and the phone simulator dock;
  - `case-canvas` (React Flow), `case-file`, `case-report` and `stage-dots`;
  - `approval-card`, `new-request` and `people`;
  - `motion.tsx`: shared animation pieces, which respect reduced motion;
  - `ui/`: dialogs, chips, copy fields.
- `src/lib/`:
  - `api.ts`: the sdk client, with sign-out on 401;
  - `session.ts`: the saved session;
  - `realtime.ts`: the live update stream;
  - `device-key.ts`: the signing key in browser storage;
  - `cases.ts`, `people.ts`, `nav.ts`: view helpers.
- `src/index.css`: Tailwind, with the colour tokens from `@onehuman/ui`.

## Rules for this app

- Colours only from the token classes (`bg-surface`, `text-fg-muted`, `bg-canvas`…). `tokens.test.ts` fails on raw colours.
- People never see tool names, ids or raw data. Use the sdk's `readableFields`, `caseFileLines` and the report helpers.
- Animations use `motion` inside the shell's `MotionConfig reducedMotion="user"`.
- Don't bump React here alone: the repository shares Expo's version.

## Browser tests (`e2e/`)

Playwright, Chromium only:
- `journey.spec.ts`: signup to report, including the role holder approving in a second browser context;
- `cases.spec.ts`, `roles.spec.ts`, `theme.spec.ts`: cases, roles and themes;
- `layout.spec.ts`: the main pages at 390 px phone width.

Run them against a running `pnpm dev` with `pnpm e2e`. Install the browser once with `pnpm --filter @onehuman/web exec playwright install chromium`. More in [docs/testing.md](../docs/testing.md).
