# Start here

ONEHUMAN OS is one platform for any kind of organization: a power plant, a lender, a hospital, a municipality. AI agents do the work. Named people approve what matters, from the web or their phone. This page shows where to read next, depending on who you are.

## Choose your path

| You are… | Read these, in order |
|---|---|
| **New to the product** (owner, manager, investor, designer) | [How it works](how-it-works.md) → [Glossary](glossary.md) → the [demo guide](demo.md) |
| **A developer joining the project** | The [README](../README.md) → [Contributing](../CONTRIBUTING.md) → [How it works](how-it-works.md) → the README of the folder you will work in (below) |
| **Writing content for a new kind of organization** | [How it works](how-it-works.md) → [Pack guide](packs.md) → [packs/](../packs/README.md) → [evals/](../evals/README.md) |
| **Running the demo or a deployment** | [Demo guide](demo.md) → [infra/](../infra/README.md) |
| **Checking what is unfinished** | [Known gaps](known-gaps.md) |

## Every document

**The product**
- [How it works](how-it-works.md): one request's journey through the 8 stages, in plain words.
- [Glossary](glossary.md): every term the product and the code use.
- [Known gaps](known-gaps.md): what isn't handled yet, live-model findings, and questions for sector experts.

**Building it**
- [Contributing](../CONTRIBUTING.md): set up, the daily loop, the rules that are easy to break, and how to add things.
- [Testing](testing.md): each kind of test, what it proves, and how to run it.
- [Pack guide](packs.md): how to write a pack for a new kind of organization.
- [Demo guide](demo.md): putting the demo online (Supabase, a tunnel, Vercel).

**Why it is built this way**
- [Architecture plan](architecture-plan.md): the original full-stack plan this repository implements.
- [Decision records](adr/README.md): eleven decisions, each with its context and consequences.
- [Design spec for organization types and cases](superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md): the design behind the 8-stage lifecycle.
- [Build plans](superpowers/plans/): the seven plans the lifecycle was built in, task by task.

**Each folder**

| Folder | What lives there |
|---|---|
| [master-ai-backend/](../master-ai-backend/README.md) | The API and the worker that runs agents and case workflows |
| [master-ai-web/](../master-ai-web/README.md) | The web app owners and their teams use |
| [master-ai-mobile/](../master-ai-mobile/README.md) | The phone app for approvals, cases, calls and the daily pulse |
| [packages/](../packages/README.md) | Code shared by the apps: schemas, agent kit, policy engine, SDK, design tokens |
| [packs/](../packs/README.md) | What the platform knows about each kind of organization, as YAML |
| [evals/](../evals/README.md) | Scored test sets, and the plan for the full end-to-end run |
| [infra/](../infra/README.md) | The local stack, the CI end-to-end script, and the demo runner |
