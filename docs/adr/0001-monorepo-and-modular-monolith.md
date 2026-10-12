# 0001. Monorepo with three app folders, modular monolith backend

Date: 2026-10-12 · Status: accepted

## Context
The plan calls for one pnpm + Turborepo monorepo. The repository started with three folders: `master-ai-backend`, `master-ai-web`, `master-ai-mobile`.

## Decision
- The root is the pnpm workspace. The three folders are its apps, next to `packages/*` (schemas, agent-kit, policy, sdk, ui) and `packs/`.
- One React version (19.2.3, Expo SDK 57's) across the repo. With pnpm's hoisted linker, a second React copy breaks React Native at runtime. For the same reason the web app uses React Router 7, since v8 requires React ≥ 19.2.7.
- The backend is a NestJS 11 modular monolith (CommonJS) with two entry points: `main.ts` (API) and `worker.ts` (Temporal worker), sharing the same modules. NestJS 12 (ESM-only, released September 2026) can be adopted once it settles.
- Shared packages build to `dist` with tsup (ESM + CJS + d.ts); Turborepo orders the builds.

## Consequences
One type change is checked across web, mobile and backend in one build. Every backend module (identity, tenancy, packs, agents, goals, approvals, policy, audit, records, knowledge, ops, realtime) is a future service boundary.
