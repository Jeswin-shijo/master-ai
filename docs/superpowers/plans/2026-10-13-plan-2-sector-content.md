# Plan 2 — Sector content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the research into installable content: 5 sector base packs and 15 ready-made organization packs, each with its 8 named stages, case types, approval rules, playbooks and a scored test set. Add offline composition for the types people type in.

**Architecture:**
- **Code:**
  - The schemas gain the taxonomy (`ORG_TYPES`), `playbooks` and `other_org_types`.
  - agent-kit gains quality checks for packs, and `composeForSector()`, which builds a pack for a typed-in organization type inside its chosen sector.
  - The evals package gains a `pack:check` command that checks a draft pack and its test set in isolation, so several authors can work at once.
- **Content:**
  - I write one sector pack and one organization pack myself as the reference, along with the authoring guide.
  - Author agents write the rest, one per organization type, grouped by sector. A verifier per sector checks each pack's realism, rule safety and test honesty.
  - Finally, completeness tests tie the taxonomy, the packs and the test sets together.

**Tech stack:** TypeScript 5.9, Zod 4, Vitest 5, YAML packs, Node 24 (runs `.ts` scripts directly), pnpm + Turborepo.

**Spec:** [docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md](../specs/2026-10-12-org-types-and-case-lifecycle-design.md), sections 1, 4 and Appendices A–B. Plan 1 ([2026-10-13-plan-1-lifecycle-foundations.md](2026-10-13-plan-1-lifecycle-foundations.md)) built the lifecycle schemas, gates, offline stages and `pnpm evals` this plan uses.

## Global Constraints

- Every check must stay green: `pnpm turbo run build typecheck test`. After changing `packages/*`, run `pnpm build:packages` before typechecking the apps.
- No new dependencies.
- Sector ids, verbatim: `energy-heavy-industry, trade-logistics-tourism, finance-development, technology-innovation, public-services`. Sector base pack ids are `sector-<sector id>`.
- Ready-made type ids: `power-plant, manufacturing-plant, construction, logistics, wholesale-retail, travel-agency, lender, accounting-firm, ngo, software-saas, it-services, digital-agency, hospital, education, municipal`.
- Stage names are 2–5 plain words in sentence case, in the organization's own words, at most 48 characters.
- Owners never see tool names, ids or JSON. Playbooks, stage descriptions and reasons are plain sentences. Money is ₹.
- Packs never give `case.proceed` or `case.close` to an agent, never alias them, and never put `case-coordinator` in a workflow step. Plan 1's validation refuses all three.
- Platform rules every pack inherits, and test sets must reflect:
  - a case above ₹5 lakh needs the owner unless a named-role rule asks first;
  - amount rules ask when the amount is unknown;
  - a named role is asked before the owner.
- Setting `urgent_keywords` in a pack replaces the inherited list.
- Eval requests never appear in a pack's `lifecycle.examples`. This is enforced from this plan on.
- In pack YAML, quote text that contains commas or starts with a quote character. Routine `ask` questions end with "?".
- `travel-agency` keeps every entity, agent, tool, workflow, policy, KPI and routine it has today; the upgrade only adds.

## Deviations from the spec (decided while planning)

1. **The case coordinator counts as a 2–5 word "Case coordinator" agent in every pack**, inherited from core-business. Organization packs don't redefine it.
2. **Sector base packs extend `crm-base`.** Organization packs extend their sector pack plus, where it fits, one business base pack (`orders-base`, `bookings-base` or `projects-base`). See the table in Task 4.
3. **Playbooks are pack data in this plan.** Loading them into each company's Knowledge at install, and through the update banner, is Plan 3, which owns install. `PackUpdates` doesn't change here.
4. **`other_org_types` lives on sector base packs only,** and isn't inherited.

## Review Focus

These five inputs aren't covered by the happy-path tests and are the most likely to hurt a real user. Each line names the test that pins it, in the task that owns the code.

1. **A typed-in type whose words belong to another sector:** "cement bank" typed under Energy must stay in Energy and borrow an Energy type, never a Finance pack. Pinned in Task 2, "stays inside the chosen sector".
2. **A travel workspace installed before this plan:** the update banner must offer the lifecycle, and applying it must validate. Pinned in Task 4, "upgrades a pre-lifecycle travel workspace cleanly".
3. **Industry text that used to be composed and now matches a ready-made pack:** "Dental clinic", "Coaching institute" and "Construction company" must get the curated pack, and construction must keep the daily work report. Pinned in Task 4, "ready-made packs now win for common types".
4. **A sector pack pointing a similar type at another sector's pack:** it must be refused, or offline mode would build a hospital on a lender's stages. Pinned in Task 1, "refuses closest types from another sector".
5. **A pack whose examples copy its test set:** the check must refuse it, or the scores would be meaningless. Pinned in Task 3, "refuses examples copied from the test set".

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/schemas/src/lifecycle.ts` | + `ORG_TYPES` |
| `packages/schemas/src/pack.ts` | + `PlaybookSchema`, `OtherOrgTypeSchema`; `playbooks`, `other_org_types` on `PackSchema` |
| `packages/agent-kit/src/pack.ts` | `resolvePack` merges playbooks by id |
| `packages/agent-kit/src/lifecycle/quality.ts` (new) | `checkPackQuality(resolved)`, `checkSectorPack(pack)` |
| `packages/agent-kit/src/match.ts` | `industryPacksInSector`, `composeForSector` |
| `packages/agent-kit/src/quality.test.ts`, `compose.test.ts` (new) | Tests |
| `packages/agent-kit/src/registry.test.ts` (new) | Completeness: taxonomy ↔ packs ↔ quality, real `composeForSector` |
| `packages/agent-kit/src/pack.test.ts` | Expectations that change because ready-made packs now exist |
| `packages/policy/src/engine.test.ts`, `gates.test.ts`, `packages/agent-kit/src/match.ts` (`composeOfflinePack`) | Pack literals gain `playbooks: [], other_org_types: []` |
| `evals/src/check-lib.ts`, `evals/src/check.ts`, `evals/src/check.test.ts` (new) | `checkDraft()` and the `pnpm pack:check` command |
| `evals/src/suites.test.ts` | Every sector-tagged industry pack has a suite; no example leakage |
| `evals/tsconfig.json`, `package.json` | `allowImportingTsExtensions`; root `pack:check` script |
| `docs/packs.md` (new) | Pack authoring guide (also the author agents' brief) |
| `packs/sector-*/pack.yaml` (5 new) | Sector base packs |
| `packs/<org-type>/pack.yaml` (14 new, `travel-agency` upgraded) | Organization packs |
| `evals/suites/<org-type>.yaml` (15 new) | Test sets |
| `.superpowers/research/municipal.draft.json` (new, gitignored) | Municipal research draft |
| `README.md`, `evals/README.md` | What ships |

---

### Task 1: Taxonomy, playbooks, similar types and pack quality checks

**Files:**
- Modify: `packages/schemas/src/lifecycle.ts`, `packages/schemas/src/pack.ts`
- Modify: `packages/agent-kit/src/pack.ts` (`resolvePack`), `packages/agent-kit/src/match.ts` (`composeOfflinePack` literal), `packages/agent-kit/src/lifecycle/index.ts`
- Create: `packages/agent-kit/src/lifecycle/quality.ts`
- Modify: `packages/policy/src/engine.test.ts`, `packages/policy/src/gates.test.ts` (pack literals)
- Test: `packages/agent-kit/src/quality.test.ts` (new)

**Interfaces:**
- Produces:
  - `ORG_TYPES: readonly { id: string; name: string; sector: SectorId }[]`.
  - `PlaybookSchema`, `Playbook = { id; title; body; source? }`, `OtherOrgTypeSchema`, `OtherOrgType = { name; keywords: string[]; closest }`.
  - `Pack.playbooks: Playbook[]` and `Pack.other_org_types: OtherOrgType[]`, both defaulting to `[]`.
  - `checkPackQuality(pack: ResolvedPack): string[]` and `checkSectorPack(pack: Pack): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ORG_TYPES, PackSchema, SECTOR_IDS, type Pack } from '@onehuman/schemas';
import { checkPackQuality, checkSectorPack, parsePack, resolvePack } from './index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const read = (id: string) => parsePack(parse(readFileSync(join(__dirname, `../../../packs/${id}/pack.yaml`), 'utf8')));
const base = new Map<string, Pack>(['core-business', 'crm-base'].map((id) => [id, read(id)]));

const body = 'Check the request, write down what is missing, and call the person back the same day. '.repeat(3);
const STAGES = {
  request: { name: 'Job raised' }, review: { name: 'First check' }, classify: { name: 'Priority set' }, assign: { name: 'Crew named' },
  approve: { name: 'Permit and clearance' }, execute: { name: 'Work under permit' }, close: { name: 'Permit returned' }, report: { name: 'Monthly review' },
};
const categories = ['breakdown', 'maintenance', 'shutdown', 'permit', 'complaint'].map((id, i) => ({
  id, name: `Kind ${id}`, keywords: [`${id} one`, `${id} two`, `${id} three`], priority: (['P1', 'P2', 'P3', 'P4', 'P3'] as const)[i]!, department: 'Plant',
}));

function sectorPack(overrides: Record<string, unknown> = {}): Pack {
  return parsePack({
    id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy & Heavy Industry', description: 'Sector base', kind: 'base',
    sector: 'energy-heavy-industry', extends: ['crm-base'],
    lifecycle: { case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' }, stages: STAGES, categories },
    playbooks: [1, 2, 3].map((n) => ({ id: `sector-pb-${n}`, title: `Playbook ${n}`, body })),
    other_org_types: ['cement', 'steel', 'mining', 'oil', 'gas', 'chemical', 'solar epc', 'wind'].map((k) => ({ name: `${k} works`, keywords: [k], closest: 'manufacturing-plant' })),
    ...overrides,
  });
}

function orgPack(overrides: Record<string, unknown> = {}): Pack {
  return parsePack({
    id: 'power-plant', version: '1.0.0', name: 'Power plant & utilities', description: 'Generation', sector: 'energy-heavy-industry',
    extends: ['sector-energy-heavy-industry'],
    lifecycle: {
      case: { label: 'Job', plural: 'Jobs', prefix: 'JOB' },
      stages: STAGES,
      roles: [{ id: 'shift-charge-engineer', name: 'Shift charge engineer', approves: 'Permits' }],
      urgent_keywords: ['fire', 'electrocution', 'explosion'],
      categories,
      examples: categories.flatMap((c) => [1, 2].map((n) => ({ request: `${c.id} example ${n}`, category: c.id, priority: c.priority, approval: false }))),
    },
    playbooks: [1, 2, 3].map((n) => ({ id: `pp-${n}`, title: `Playbook ${n}`, body })),
    ...overrides,
  });
}

function resolve(pack: Pack, sector = sectorPack()) {
  const all = new Map(base);
  all.set(sector.id, sector);
  all.set(pack.id, pack);
  return resolvePack(pack, (id) => all.get(id));
}

describe('taxonomy', () => {
  it('has three ready-made types per sector', () => {
    for (const sector of SECTOR_IDS) expect(ORG_TYPES.filter((t) => t.sector === sector)).toHaveLength(3);
    expect(ORG_TYPES.map((t) => t.id)).toContain('travel-agency');
  });

  it('parses playbooks and similar types, and defaults them to empty', () => {
    const minimal = PackSchema.parse({ id: 'x', version: '1.0.0', name: 'X', description: 'x' });
    expect(minimal.playbooks).toEqual([]);
    expect(minimal.other_org_types).toEqual([]);
    expect(() => PackSchema.parse({ id: 'x', version: '1.0.0', name: 'X', description: 'x', playbooks: [{ id: 'a', title: 'A', body: 'too short' }] })).toThrow();
  });

  it('merges playbooks down the chain by id', () => {
    const resolved = resolve(orgPack({ playbooks: [{ id: 'sector-pb-1', title: 'Own version', body }, { id: 'pp-9', title: 'Extra', body }] }));
    expect(resolved.playbooks.map((p) => p.id).sort()).toEqual(['pp-9', 'sector-pb-1', 'sector-pb-2', 'sector-pb-3']);
    expect(resolved.playbooks.find((p) => p.id === 'sector-pb-1')!.title).toBe('Own version');
  });
});

describe('checkPackQuality', () => {
  it('passes a complete organization pack', () => {
    expect(checkPackQuality(resolve(orgPack()))).toEqual([]);
  });

  it('names what a thin pack lacks', () => {
    const thin = orgPack({
      lifecycle: { stages: { ...STAGES, review: { name: 'Check' } }, categories: categories.slice(0, 3).map((c) => ({ ...c, keywords: ['one'] })) },
      playbooks: [],
    });
    expect(checkPackQuality(resolve(thin))).toEqual(expect.arrayContaining([
      'lifecycle: the case still has the generic name "Case"',
      'stage review: "Check" should be 2 to 5 words',
      'lifecycle: needs at least 5 case types of its own (has 3)',
      'case type breakdown: needs at least 3 keywords',
      'case type breakdown: needs at least 2 worked examples',
      'playbooks: needs 3 to 6 (has 3 from the sector, none of its own)',
      'lifecycle: needs its own urgent keywords',
      'lifecycle: needs at least one approver role besides the owner',
    ]));
  });

  it('needs the pack to sit under its sector pack', () => {
    const loose = orgPack({ extends: ['crm-base'] });
    expect(checkPackQuality(resolve(loose))).toContain('lineage: must extend sector-energy-heavy-industry');
  });
});

describe('checkSectorPack', () => {
  it('passes a complete sector pack', () => {
    expect(checkSectorPack(sectorPack())).toEqual([]);
  });

  it('refuses closest types from another sector', () => {
    const wrong = sectorPack({ other_org_types: [...sectorPack().other_org_types, { name: 'Clinic chain', keywords: ['clinic'], closest: 'hospital' }] });
    expect(checkSectorPack(wrong)).toContain('similar type "Clinic chain": hospital is not a ready-made type in energy-heavy-industry');
  });

  it('names a misnamed or thin sector pack', () => {
    expect(checkSectorPack(sectorPack({ id: 'sector-energy', other_org_types: [] }))).toEqual(expect.arrayContaining([
      'id: a sector base pack must be called sector-energy-heavy-industry',
      'other_org_types: needs at least 8 similar types (has 0)',
    ]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/quality.test.ts`
Expected: FAIL. `ORG_TYPES`, `checkPackQuality` and `checkSectorPack` aren't exported.

- [ ] **Step 3: Add the taxonomy to `packages/schemas/src/lifecycle.ts`**

Append after `SECTORS`:

```ts
/** The ready-made organization types offered at signup, three per sector. Each has a pack with the same id. */
export const ORG_TYPES: readonly { id: string; name: string; sector: SectorId }[] = [
  { id: 'power-plant', name: 'Power plant & utilities', sector: 'energy-heavy-industry' },
  { id: 'manufacturing-plant', name: 'Manufacturing plant', sector: 'energy-heavy-industry' },
  { id: 'construction', name: 'Construction & infrastructure', sector: 'energy-heavy-industry' },
  { id: 'logistics', name: 'Logistics & transport', sector: 'trade-logistics-tourism' },
  { id: 'wholesale-retail', name: 'Wholesale & retail trade', sector: 'trade-logistics-tourism' },
  { id: 'travel-agency', name: 'Travel agency & tour operator', sector: 'trade-logistics-tourism' },
  { id: 'lender', name: 'Lender (NBFC, microfinance, co-op bank)', sector: 'finance-development' },
  { id: 'accounting-firm', name: 'Accounting & tax firm', sector: 'finance-development' },
  { id: 'ngo', name: 'NGO & development programme', sector: 'finance-development' },
  { id: 'software-saas', name: 'Software & SaaS company', sector: 'technology-innovation' },
  { id: 'it-services', name: 'IT services & support', sector: 'technology-innovation' },
  { id: 'digital-agency', name: 'Digital agency', sector: 'technology-innovation' },
  { id: 'hospital', name: 'Hospital & clinic', sector: 'public-services' },
  { id: 'education', name: 'School, college & coaching', sector: 'public-services' },
  { id: 'municipal', name: 'Municipal & citizen services', sector: 'public-services' },
];
```

- [ ] **Step 4: Add playbooks and similar types to `packages/schemas/src/pack.ts`**

Above `PackSchema`, add:

```ts
/** A procedure agents follow and cite. Loaded into the company's knowledge base at install. */
export const PlaybookSchema = z.strictObject({
  id: SlugSchema,
  title: z.string().min(1),
  /** Markdown: the procedure in plain steps. */
  body: z.string().min(80),
  source: z.string().optional(),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

/** On a sector base pack: an organization type people may type in, and the ready-made type it is closest to. */
export const OtherOrgTypeSchema = z.strictObject({
  name: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  closest: SlugSchema,
});
export type OtherOrgType = z.infer<typeof OtherOrgTypeSchema>;
```

In `PackSchema`, after `connectors`, add:

```ts
  /** Procedures for the company's knowledge base (permit-to-work, KYC, triage...). */
  playbooks: z.array(PlaybookSchema).default([]),
  /** Sector base packs only: typed-in organization types and the ready-made type each borrows offline. */
  other_org_types: z.array(OtherOrgTypeSchema).default([]),
```

- [ ] **Step 5: Merge playbooks in `resolvePack` and fix the pack literals**

In `packages/agent-kit/src/pack.ts`, `resolvePack`:
- Add `playbooks: []` to the `merged` initializer object, next to `connectors: []`.
- Declare `const playbooks = new Map<string, Pack['playbooks'][number]>();` next to `const kpis`.
- Inside the `for (const p of chain)` loop, add `(p.playbooks ?? []).forEach((b) => playbooks.set(b.id, b));`. The `?? []` covers snapshots stored before playbooks existed.
- After `merged.kpis = …`, add `merged.playbooks = [...playbooks.values()];`.

`other_org_types` stays the resolving pack's own, through the `...ownPack` spread.

In `packages/agent-kit/src/match.ts`, `composeOfflinePack`, add `playbooks: [],` and `other_org_types: [],` after `connectors: [],` in the returned literal.

In `packages/policy/src/engine.test.ts` and `packages/policy/src/gates.test.ts`, add `playbooks: [], other_org_types: [],` to the `pack` literal next to `connectors: []`.

- [ ] **Step 6: Create `packages/agent-kit/src/lifecycle/quality.ts`**

```ts
import { ORG_TYPES, STAGE_KEYS, type Pack, type ResolvedPack } from '@onehuman/schemas';
import { GENERIC_LIFECYCLE } from './generic';

/**
 * Quality bar for ready-made content. validatePackRefs says whether a pack
 * works; these checks say whether it is good enough to offer at signup.
 * Convention: sector playbook ids start with "sector-", organization playbook ids never do.
 */

const words = (name: string) => name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));

function stageNameIssues(key: string, name: string): string[] {
  const n = words(name).length;
  return n < 2 || n > 5 ? [`stage ${key}: "${name}" should be 2 to 5 words`] : [];
}

/** For a ready-made organization pack, resolved. */
export function checkPackQuality(pack: ResolvedPack): string[] {
  const issues: string[] = [];
  const lc = pack.lifecycle;
  if (!pack.sector) return ['sector: a ready-made pack needs its sector'];
  if (!pack.lineage.includes(`sector-${pack.sector}`)) issues.push(`lineage: must extend sector-${pack.sector}`);
  if (!lc) return [...issues, 'lifecycle: missing'];

  if (lc.case.label === GENERIC_LIFECYCLE.case.label) issues.push('lifecycle: the case still has the generic name "Case"');
  for (const stage of lc.stages) {
    const generic = GENERIC_LIFECYCLE.stages.find((s) => s.key === stage.key)!;
    if (stage.name === generic.name) issues.push(`stage ${stage.key}: still has the generic name "${stage.name}"`);
    else issues.push(...stageNameIssues(stage.key, stage.name));
  }

  const own = lc.categories.filter((c) => c.id !== lc.fallback_category);
  if (own.length < 5) issues.push(`lifecycle: needs at least 5 case types of its own (has ${own.length})`);
  for (const c of own) {
    if (c.keywords.length < 3) issues.push(`case type ${c.id}: needs at least 3 keywords`);
    if (lc.examples.filter((e) => e.category === c.id).length < 2) issues.push(`case type ${c.id}: needs at least 2 worked examples`);
  }

  if (!lc.roles.some((r) => r.id !== 'owner')) issues.push('lifecycle: needs at least one approver role besides the owner');
  const genericUrgent = [...GENERIC_LIFECYCLE.urgent_keywords].sort().join('|');
  if (lc.urgent_keywords.length < 3 || [...lc.urgent_keywords].sort().join('|') === genericUrgent) {
    issues.push('lifecycle: needs its own urgent keywords');
  }

  const inherited = pack.playbooks.filter((p) => p.id.startsWith('sector-')).length;
  const ownPlaybooks = pack.playbooks.length - inherited;
  if (ownPlaybooks < 3 || ownPlaybooks > 6) {
    issues.push(`playbooks: needs 3 to 6 (has ${inherited} from the sector, ${ownPlaybooks === 0 ? 'none' : ownPlaybooks} of its own)`);
  }
  for (const p of pack.playbooks) if (p.body.length < 200) issues.push(`playbook ${p.id}: body is too short to follow`);
  return issues;
}

/** For a sector base pack, unresolved (its own content only). */
export function checkSectorPack(pack: Pack): string[] {
  const issues: string[] = [];
  if (pack.kind !== 'base') issues.push('kind: a sector pack is a base pack');
  if (!pack.sector) return [...issues, 'sector: missing'];
  if (pack.id !== `sector-${pack.sector}`) issues.push(`id: a sector base pack must be called sector-${pack.sector}`);

  const lc = pack.lifecycle;
  if (!lc?.case) issues.push('lifecycle: needs a case name for the sector');
  for (const key of STAGE_KEYS) {
    const stage = lc?.stages[key];
    if (!stage) issues.push(`stage ${key}: needs a sector name`);
    else issues.push(...stageNameIssues(key, stage.name));
  }
  const categories = lc?.categories ?? [];
  if (categories.length < 5) issues.push(`lifecycle: needs at least 5 broad case types (has ${categories.length})`);
  for (const c of categories) if (c.keywords.length < 3) issues.push(`case type ${c.id}: needs at least 3 keywords`);
  if (pack.playbooks.length < 3) issues.push(`playbooks: needs at least 3 (has ${pack.playbooks.length})`);
  for (const p of pack.playbooks) if (!p.id.startsWith('sector-')) issues.push(`playbook ${p.id}: sector playbook ids start with "sector-"`);

  const inSector = new Set(ORG_TYPES.filter((t) => t.sector === pack.sector).map((t) => t.id));
  if (pack.other_org_types.length < 8) issues.push(`other_org_types: needs at least 8 similar types (has ${pack.other_org_types.length})`);
  for (const t of pack.other_org_types) {
    if (!inSector.has(t.closest)) issues.push(`similar type "${t.name}": ${t.closest} is not a ready-made type in ${pack.sector}`);
  }
  return issues;
}
```

Append to `packages/agent-kit/src/lifecycle/index.ts`:

```ts
export * from './quality';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @onehuman/schemas build && pnpm --filter @onehuman/agent-kit exec vitest run src/quality.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful. The two policy test literals and `composeOfflinePack` now carry the new keys.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src packages/agent-kit/src packages/policy/src
git commit -m "feat(packs): organization taxonomy, playbooks, similar types and pack quality checks"
```

---

### Task 2: Offline composition inside a chosen sector

**Files:**
- Modify: `packages/agent-kit/src/match.ts`
- Test: `packages/agent-kit/src/compose.test.ts` (new)

**Interfaces:**
- Consumes: `Pack.sector`, `Pack.other_org_types` (Task 1); `matchIndustry`, `composeOfflinePack` (existing).
- Produces:
  - `industryPacksInSector(packs: Pack[], sector: SectorId): Pack[]`.
  - `SectorComposition = { pack: Pack; basedOn: string; via: 'ready-made' | 'similar' | 'sector' }`.
  - `composeForSector(industry: string, sector: SectorId, packs: Pack[]): SectorComposition`. It throws `PackError` when the sector base pack is missing.
- Plan 3 calls it from `PackGenerator.draft` when no ready-made pack matched and no model is configured.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-kit/src/compose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeForSector, industryPacksInSector, PackError, parsePack } from './index';

const pack = (p: Record<string, unknown>) => parsePack({ version: '1.0.0', description: 'test', ...p });
const packs = [
  pack({
    id: 'sector-energy-heavy-industry', name: 'Energy & Heavy Industry', kind: 'base', sector: 'energy-heavy-industry',
    other_org_types: [
      { name: 'Cement plant', keywords: ['cement', 'clinker'], closest: 'mfg-test' },
      { name: 'Steel plant', keywords: ['steel'], closest: 'missing-pack' },
    ],
  }),
  pack({ id: 'pp-test', name: 'Power plant & utilities', sector: 'energy-heavy-industry', match: { keywords: ['power plant', 'thermal plant'] } }),
  pack({ id: 'mfg-test', name: 'Manufacturing plant', sector: 'energy-heavy-industry', match: { keywords: ['factory'] } }),
  pack({ id: 'bank-test', name: 'Cement bank', sector: 'finance-development', match: { keywords: ['cement bank'] } }),
];

describe('composeForSector', () => {
  it('lists the ready-made packs of one sector', () => {
    expect(industryPacksInSector(packs, 'energy-heavy-industry').map((p) => p.id)).toEqual(['pp-test', 'mfg-test']);
  });

  it('builds on a ready-made type when the words match one', () => {
    const c = composeForSector('Thermal power plant in Nellore', 'energy-heavy-industry', packs);
    expect(c).toMatchObject({ basedOn: 'pp-test', via: 'ready-made' });
    expect(c.pack).toMatchObject({ extends: ['pp-test'], sector: 'energy-heavy-industry', kind: 'industry', name: 'Thermal Power Plant in Nellore' });
  });

  it('borrows the closest ready-made type for a similar organization', () => {
    expect(composeForSector('Cement grinding unit', 'energy-heavy-industry', packs)).toMatchObject({ basedOn: 'mfg-test', via: 'similar' });
  });

  it('falls back to the sector base when the closest type is not installed', () => {
    expect(composeForSector('Steel rolling mill', 'energy-heavy-industry', packs)).toMatchObject({ basedOn: 'sector-energy-heavy-industry', via: 'sector' });
  });

  it('falls back to the sector base when nothing is similar', () => {
    const c = composeForSector('Scrap recycling yard', 'energy-heavy-industry', packs);
    expect(c).toMatchObject({ basedOn: 'sector-energy-heavy-industry', via: 'sector' });
    expect(c.pack.extends).toEqual(['sector-energy-heavy-industry']);
  });

  it('stays inside the chosen sector', () => {
    expect(composeForSector('cement bank', 'energy-heavy-industry', packs)).toMatchObject({ basedOn: 'mfg-test', via: 'similar' });
  });

  it('refuses a sector without a base pack', () => {
    expect(() => composeForSector('Clinic', 'public-services', packs)).toThrow(PackError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/compose.test.ts`
Expected: FAIL. `composeForSector` and `industryPacksInSector` aren't exported.

- [ ] **Step 3: Implement in `packages/agent-kit/src/match.ts`**

Change the import at the top to:

```ts
import type { Pack, SectorId } from '@onehuman/schemas';
import { PackError } from './pack';
```

Append at the end of the file:

```ts
export function industryPacksInSector(packs: Pack[], sector: SectorId): Pack[] {
  return packs.filter((p) => p.kind === 'industry' && p.sector === sector);
}

export interface SectorComposition {
  pack: Pack;
  /** The pack it builds on: a ready-made type or the sector base pack. */
  basedOn: string;
  via: 'ready-made' | 'similar' | 'sector';
}

/**
 * Offline setup for an organization type typed in after choosing a sector:
 * build on a ready-made type of that sector when the words match one, else on
 * the closest one the sector lists as similar, else on the sector base pack.
 * Other sectors are never considered: the owner chose this one.
 */
export function composeForSector(industry: string, sector: SectorId, packs: Pack[]): SectorComposition {
  const baseId = `sector-${sector}`;
  const base = packs.find((p) => p.id === baseId);
  if (!base) throw new PackError(`No base pack for sector ${sector}`);
  const inSector = industryPacksInSector(packs, sector);
  const available = new Set(inSector.map((p) => p.id));

  let basedOn = baseId;
  let via: SectorComposition['via'] = 'sector';
  const direct = matchIndustry(industry, inSector);
  if (direct) {
    basedOn = direct.pack.id;
    via = 'ready-made';
  } else {
    let best: { closest: string; score: number } | null = null;
    for (const t of base.other_org_types) {
      if (!available.has(t.closest)) continue;
      const score = Math.max(0, ...t.keywords.filter((k) => containsPhrase(industry, k)).map((k) => tokens(k).length));
      if (score > 0 && (!best || score > best.score)) best = { closest: t.closest, score };
    }
    if (best) {
      basedOn = best.closest;
      via = 'similar';
    }
  }
  return { pack: { ...composeOfflinePack(industry), sector, extends: [basedOn] }, basedOn, via };
}
```

`pack.ts` doesn't import `match.ts`, so importing `PackError` from `./pack` adds no cycle.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/compose.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm turbo run build typecheck test`
Expected: all successful.

```bash
git add packages/agent-kit/src
git commit -m "feat(agent-kit): compose packs for typed-in organization types inside their sector"
```

---

### Task 3: The pack check command, the authoring guide and the reference content

**Files:**
- Create: `evals/src/check-lib.ts`, `evals/src/check.ts`, `evals/src/check.test.ts`
- Modify: `evals/tsconfig.json` (add `"allowImportingTsExtensions": true` to `compilerOptions`), root `package.json` (script `"pack:check": "node evals/src/check.ts"`)
- Create: `docs/packs.md`
- Create: `packs/sector-energy-heavy-industry/pack.yaml`, `packs/power-plant/pack.yaml`, `evals/suites/power-plant.yaml`

**Interfaces:**
- Consumes: `checkPackQuality`, `checkSectorPack` (Task 1); `runSuite`, `EvalSuiteSchema`, `THRESHOLDS`, `formatScorecard` (Plan 1, `evals/src/runner.ts`).
- Produces:
  - `checkDraft({ packYaml, suiteYaml?, packsDir }): { packId: string | null; issues: string[]; scorecard: Scorecard | null; ok: boolean }`.
  - `pnpm pack:check --pack <file> [--suite <file>]`, which exits 0 when the draft is clean.
  - The reference packs Task 4's authors copy the shape of.

- [ ] **Step 1: Write the failing test**

Create `evals/src/check.test.ts`:

```ts
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { checkDraft } from './check-lib.ts';

/** A throwaway packs dir: real core-business and crm-base plus a fixture sector pack. */
const packsDir = mkdtempSync(join(tmpdir(), 'packs-'));
const repoPacks = new URL('../../packs', import.meta.url).pathname;
for (const id of ['core-business', 'crm-base']) cpSync(join(repoPacks, id), join(packsDir, id), { recursive: true });

const body = 'Check the request, write down what is missing, and call the person back the same day. '.repeat(3);
const STAGES = {
  request: { name: 'Job raised' }, review: { name: 'First check' }, classify: { name: 'Priority set' }, assign: { name: 'Crew named' },
  approve: { name: 'Permit and clearance' }, execute: { name: 'Work under permit' }, close: { name: 'Permit returned' }, report: { name: 'Monthly review' },
};
const categories = [
  { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'tripped', 'not working'], priority: 'P1', risk: 'high', department: 'Maintenance', approval: { required: 'high_risk_or_p1', role: 'shift-charge-engineer' } },
  { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase', 'buy'], priority: 'P4', risk: 'low', department: 'Stores', approval: { required: 'above_amount', role: 'plant-head', amount_inr: 50000 } },
  { id: 'cleaning', name: 'Cleaning job', keywords: ['cleaning', 'clean', 'sweep'], priority: 'P3', department: 'Facilities' },
  { id: 'painting', name: 'Painting job', keywords: ['painting', 'paint', 'repaint'], priority: 'P4', department: 'Facilities' },
  { id: 'audit', name: 'Safety audit', keywords: ['audit', 'inspection', 'survey'], priority: 'P3', department: 'Safety' },
];
const examples = [
  ['Coal mill 2 breakdown, stopped at 3 am', 'breakdown', 'P1', true], ['Feeder 4 tripped again', 'breakdown', 'P1', true],
  ['Please buy spares for the ash pump', 'spares', 'P4', false], ['Purchase gaskets for the heater', 'spares', 'P4', false],
  ['Clean the control room floor', 'cleaning', 'P3', false], ['Sweep the yard near gate 2', 'cleaning', 'P3', false],
  ['Repaint the stair rails', 'painting', 'P4', false], ['Paint the new store room', 'painting', 'P4', false],
  ['Fire safety audit due next week', 'audit', 'P3', false], ['Annual inspection of the cranes', 'audit', 'P3', false],
].map(([request, category, priority, approval]) => ({ request, category, priority, approval }));

mkdirSync(join(packsDir, 'sector-energy-heavy-industry'));
writeFileSync(join(packsDir, 'sector-energy-heavy-industry', 'pack.yaml'), stringify({
  id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy & Heavy Industry', description: 'Sector base', kind: 'base',
  sector: 'energy-heavy-industry', extends: ['crm-base'],
  lifecycle: { case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' }, stages: STAGES, categories },
  playbooks: [1, 2, 3].map((n) => ({ id: `sector-pb-${n}`, title: `Sector playbook ${n}`, body })),
  other_org_types: ['cement', 'steel', 'mining', 'oil', 'gas', 'chemical', 'solar epc', 'wind'].map((k) => ({ name: `${k} works`, keywords: [k], closest: 'manufacturing-plant' })),
}));

const draft = (overrides: Record<string, unknown> = {}) => stringify({
  id: 'power-plant', version: '1.0.0', name: 'Power plant & utilities', description: 'Generation', sector: 'energy-heavy-industry',
  extends: ['sector-energy-heavy-industry'],
  lifecycle: {
    case: { label: 'Job', plural: 'Jobs', prefix: 'JOB' }, stages: STAGES,
    roles: [{ id: 'shift-charge-engineer', name: 'Shift charge engineer', approves: 'Permits' }, { id: 'plant-head', name: 'Plant head', approves: 'Purchases' }],
    urgent_keywords: ['fire', 'electrocution', 'explosion'], categories, examples,
  },
  playbooks: [1, 2, 3].map((n) => ({ id: `pp-${n}`, title: `Plant playbook ${n}`, body })),
  ...overrides,
});
const suite = (cases: object[]) => stringify({ pack: 'power-plant', cases });
const good = [
  { id: 'trip', request: 'Unit 1 tripped on low drum level at 02:14', source: 'system', expect: { category: 'breakdown', priority: 'P1', review: 'complete', approval: { required: true, role: 'shift-charge-engineer' } } },
  { id: 'gaskets', request: 'Buy 20 spares gaskets for ₹8,000', source: 'staff', expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: false } } },
];

describe('checkDraft', () => {
  it('passes a clean pack and its test set', () => {
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(good), packsDir });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scorecard!.stages.category).toEqual({ correct: 2, total: 2 });
  });

  it('reports YAML and schema errors instead of throwing', () => {
    expect(checkDraft({ packYaml: 'id: [broken', packsDir }).issues[0]).toMatch(/^pack: /);
    expect(checkDraft({ packYaml: draft({ version: 'one' }), packsDir }).ok).toBe(false);
  });

  it('reports scores below the thresholds', () => {
    const wrong = [{ ...good[0]!, expect: { ...good[0]!.expect, category: 'spares' } }];
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(wrong), packsDir });
    expect(result.issues).toContain('category 0% is below 90%');
  });

  it('refuses examples copied from the test set', () => {
    const copied = [{ ...good[0]!, request: 'Coal mill 2 breakdown, stopped at 3 am.' }];
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(copied), packsDir });
    expect(result.issues).toContain('test case trip: its request is also a worked example in the pack');
  });

  it('checks a sector pack with the sector rules', () => {
    const sectorYaml = stringify({ id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy', description: 'x', kind: 'base', sector: 'energy-heavy-industry', extends: ['crm-base'] });
    expect(checkDraft({ packYaml: sectorYaml, packsDir }).issues).toContain('other_org_types: needs at least 8 similar types (has 0)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onehuman/agent-kit build && pnpm --filter @onehuman/evals exec vitest run src/check.test.ts`
Expected: FAIL. The module `./check-lib.ts` can't be found.

- [ ] **Step 3: Create `evals/src/check-lib.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { checkPackQuality, checkSectorPack, normalizeText, parsePack, resolvePack, validatePackRefs } from '@onehuman/agent-kit';
import { EvalSuiteSchema, runSuite, THRESHOLDS, type Scorecard } from './runner.ts';

export interface DraftCheck {
  packId: string | null;
  issues: string[];
  scorecard: Scorecard | null;
  ok: boolean;
}

/**
 * The registry for checking a draft. Packs that fail to parse are skipped
 * (another author may be mid-edit); `pnpm evals` stays strict.
 */
function loadRegistryLenient(dir: string, skipId: string): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, 'pack.yaml');
    if (!existsSync(file)) continue;
    try {
      const pack = parsePack(parse(readFileSync(file, 'utf8')));
      if (pack.id !== skipId) registry.set(pack.id, pack);
    } catch {
      // skipped on purpose
    }
  }
  return registry;
}

const message = (err: unknown) => (err as Error).message.replace(/\s+/g, ' ').trim();

/** Check a draft pack (and optionally its test set) against the packs on disk. */
export function checkDraft(input: { packYaml: string; suiteYaml?: string; packsDir: string }): DraftCheck {
  const fail = (packId: string | null, issues: string[]): DraftCheck => ({ packId, issues, scorecard: null, ok: false });

  let pack: Pack;
  try {
    pack = parsePack(parse(input.packYaml));
  } catch (err) {
    return fail(null, [`pack: ${message(err)}`]);
  }
  const registry = loadRegistryLenient(input.packsDir, pack.id);
  registry.set(pack.id, pack);

  let resolved;
  try {
    resolved = resolvePack(pack, (id) => registry.get(id));
  } catch (err) {
    return fail(pack.id, [`resolve: ${message(err)}`]);
  }

  const issues = [...validatePackRefs(resolved)];
  if (pack.kind === 'base' && pack.sector) issues.push(...checkSectorPack(pack));
  if (pack.kind === 'industry' && pack.sector) issues.push(...checkPackQuality(resolved));

  let scorecard: Scorecard | null = null;
  if (input.suiteYaml !== undefined) {
    try {
      const suite = EvalSuiteSchema.parse(parse(input.suiteYaml));
      if (suite.pack !== pack.id) issues.push(`suite: written for ${suite.pack}, not ${pack.id}`);
      const examples = new Set((resolved.lifecycle?.examples ?? []).map((e) => normalizeText(e.request)));
      for (const c of suite.cases) {
        if (examples.has(normalizeText(c.request))) issues.push(`test case ${c.id}: its request is also a worked example in the pack`);
      }
      scorecard = runSuite(resolved, suite);
      for (const [stage, min] of Object.entries(THRESHOLDS)) {
        const s = scorecard.stages[stage as keyof typeof THRESHOLDS];
        if (s.total > 0 && s.correct / s.total < min) issues.push(`${stage} ${Math.round((100 * s.correct) / s.total)}% is below ${min * 100}%`);
      }
    } catch (err) {
      issues.push(`suite: ${message(err)}`);
    }
  }
  return { packId: pack.id, issues, scorecard, ok: issues.length === 0 };
}
```

Create `evals/src/check.ts`:

```ts
import { readFileSync } from 'node:fs';
import { checkDraft } from './check-lib.ts';
import { formatScorecard } from './runner.ts';

/**
 * pnpm pack:check --pack <pack.yaml> [--suite <suite.yaml>]
 * Checks a draft pack and its test set against the packs on disk.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const packPath = arg('pack');
if (!packPath) {
  console.error('Usage: pnpm pack:check --pack <pack.yaml> [--suite <suite.yaml>]');
  process.exit(2);
}
const suitePath = arg('suite');
const result = checkDraft({
  packYaml: readFileSync(packPath, 'utf8'),
  suiteYaml: suitePath ? readFileSync(suitePath, 'utf8') : undefined,
  packsDir: new URL('../../packs', import.meta.url).pathname,
});
if (result.scorecard) console.log(formatScorecard(result.scorecard));
if (result.ok) console.log(`✓ ${result.packId}: no issues`);
else console.log(`✗ ${result.packId ?? packPath}: ${result.issues.length} issue(s)\n- ${result.issues.join('\n- ')}`);
process.exit(result.ok ? 0 : 1);
```

`runner.ts` exports `formatScorecard` already. Add `"allowImportingTsExtensions": true` to `evals/tsconfig.json` `compilerOptions`. Add to the root `package.json` scripts, after `evals`: `"pack:check": "node evals/src/check.ts"`.

- [ ] **Step 4: Run the test and the command**

Run: `pnpm --filter @onehuman/evals exec vitest run src/check.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm pack:check --pack packs/core-business/pack.yaml`
Expected: `✓ core-business: no issues`, exit 0. Core-business has no sector, so only the reference checks run.

- [ ] **Step 5: Write `docs/packs.md`**

This file is both the pack authoring guide and the brief Task 4's author agents follow. Write it with exactly these sections and rules:

````markdown
# Writing an industry pack

A pack is YAML in `packs/<id>/pack.yaml`. It teaches ONEHUMAN OS how one kind of organization works: its records, its AI agents, the 8 stages every request runs through (named in its own words), its case types and approval rules, and the procedures its people follow. Read the [design spec](superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md) sections 1 and 4 first. The reference packs are `packs/sector-energy-heavy-industry` and `packs/power-plant`.

## Where things go

| What | Where |
|---|---|
| Sector base pack | `packs/sector-<sector id>/pack.yaml` (kind `base`, extends `crm-base`) |
| Organization pack | `packs/<org type id>/pack.yaml` (kind `industry`, extends its sector pack, plus one of `orders-base`, `bookings-base`, `projects-base` where it fits) |
| Test set | `evals/suites/<pack id>.yaml` |
| Work in progress | `.superpowers/drafts/<pack id>.pack.yaml` and `.suite.yaml` (gitignored) |

Check a draft with `pnpm pack:check --pack <draft> --suite <draft suite>`. Copy it into place only when it prints `✓ … no issues`, then run `pnpm evals`.

## The lifecycle

- `case`: what this organization calls one piece of work ("Job", "Loan case", "Patient request"), the plural, and a 2–4 capital-letter prefix (JOB-0042).
- `stages`: all 8 (`request, review, classify, assign, approve, execute, close, report`). Each name is 2–5 plain words, in sentence case and the organization's own words ("Permit-to-work check", "KYC and document check"). Each description is one sentence on what happens there. Give `checks` for review and close: what a careful person checks.
- `roles`: everyone who approves or signs off. Ids are kebab-case (`safety-officer`). Never use `admin` or `member`, which are access roles. The owner is inherited.
- `priorities`: P1–P4 with realistic `respond_within_hours` and `resolve_within_hours`.
- `urgent_keywords`: words that make any request P1. They **replace** the inherited list, so include the generic safety words that apply here (fire, injury, accident…) and leave out ones that are routine here (an IT company's planned "outage").
- `categories` (5–8 case types). For each:
  - `keywords`: at least 3. Use the words people really write: Indian English, common abbreviations, and both "tripped" and "trip". Avoid words that fit several categories. Matching scores each matched keyword by its number of words. The highest score wins; ties go to the more urgent priority, then to the earlier category. No match goes to the `general` category.
  - `priority`, `risk` (`low | medium | high`), `department`.
  - `required_details`: what review must find in the request. Each is `{ key, label, kind }`, where kind is `amount | date | phone | email | contact | keywords` (`keywords` needs a `keywords` list, e.g. which machine). Missing details make the case wait as "needs info".
  - `required_checks`: what a person must confirm (it can't be read from the request).
  - `not_eligible`: `{ keywords, amount_above_inr?, reason }` rules that close a case as not ours. A rule with both words and an amount needs both. Write keyword families ("own wiring", "inside the house", "licensed electrician"), not one test sentence.
  - `approval`: `always | above_amount (+ amount_inr) | high_risk_or_p1 | never`, plus the `role`.
  - `signoff`: `{ required, role }`.
  - `workflow`: the pack workflow that does the work in stage 6. `delegate-work` (inherited) hands it to a person by phone.
  - `execution`: `team | agents | both`.
- `examples`: 2–3 per category, `{ request, category, priority, approval }`. Write them fresh. **Never copy a test-set request.**

## Rules every pack inherits

- A case above ₹5 lakh needs the owner unless a category rule names a role first.
- An amount rule asks for approval when the request gives no amount.
- When several rules apply, a named role (safety officer, credit committee) is asked before the owner.
- The Case coordinator agent runs the stages. Never list it in a workflow step, never give an agent `case.proceed` or `case.close`, and never alias them.

## Everything else in the pack

- `sector`: one of the five sector ids.
- `match.keywords`: how people describe this kind of organization at signup.
- `labels`: shared record names in this sector's words (`Customer: Patient`).
- `entities` (up to 4): typed fields (string, text, number, integer, boolean, date, datetime, email, phone, money, enum with options, reference), a `title_field` and `list_columns`.
- `tools`: aliases over the catalog primitives (`records.search` with a fixed entity, `records.update` with a fixed status). Mark external reach and irreversibility honestly.
- `agents`: 1–3 work agents, each with a clear role, the tools it needs, a clearance (`autonomy` 1–4), a model tier and budgets.
- `workflows`: the stage-6 work for the categories (steps with an agent and plain instructions).
- `kpis`: 4–6. `unit` is one of count, percent, minutes, hours, inr. Use `source` only for record counts or the built-in operations metrics; without a source the KPI waits for a connector.
- `playbooks` (3–6): `{ id, title, body, source }`. The body is markdown: numbered steps in plain words, at least 200 characters. Sector playbook ids start with `sector-`; organization playbook ids never do.
- `routines` (optional): daily check-ins. Quote any `ask` that contains a comma, and end each with "?".

## The test set

`evals/suites/<pack id>.yaml` holds 10 realistic requests as people would really write or say them, from varied sources (owner, staff, customer, system, partner). Include at least one each of: needs info, not eligible, P1, no approval, and decided by an amount (`amount_inr`). Each case is:

```yaml
- id: unit-trip
  request: "ALERT 02:14 Unit-2 TRIPPED. Drum level very low. Load before trip 205 MW."
  source: system
  expect:
    category: breakdown
    priority: P1
    review: complete            # complete | needs_info | not_eligible
    approval: { required: true, role: shift-charge-engineer }
    signoff: { required: true, role: shift-charge-engineer }
  why: Tripped is a breakdown word; P1 breakdowns go to the shift charge engineer.
```

- Every expectation must follow from the pack's rules and the inherited rules above.
- Gates (approval, sign-off) are scored only for `review: complete` cases, given the expected category and priority. Their risk is high for P1, otherwise the category's risk.
- Thresholds: category 90%, priority 90%, review 80%, approval and sign-off 100%.

When a case fails, fix the pack (keywords, details, rules) the way the organization really works, not the case, unless the case was wrong.
````

- [ ] **Step 6: Write the reference content**

Write `packs/sector-energy-heavy-industry/pack.yaml` and `packs/power-plant/pack.yaml` by hand, following `docs/packs.md`:

- **Sector pack sources:** its stage names come from spec Appendix B (Energy row): Request or alarm raised, Details and safety check, Priority and risk, Assign in-charge and deadline, Permit or approval, Work in progress, Inspect and sign off, Monthly review and lessons. Its case is *Work order* (WO). It has 5–6 broad categories that fit any heavy-industry site (breakdown, safety incident, planned maintenance, purchase, quality problem, compliance), 3 `sector-` playbooks (permit-to-work, incident reporting, purchase approval), 4 KPIs and at least 8 `other_org_types`. Those borrow `power-plant` (substation, solar park, wind farm, hydro…), `manufacturing-plant` (cement, steel, chemicals, food processing, auto parts…) or `construction` (EPC contractor, road builder, real estate developer…). They must include "cement" (→ manufacturing-plant) and "solar park" (→ power-plant), which Task 4's completeness tests use.
- **Power-plant pack source:** `.superpowers/research/power-plant.draft.json`. Act as an Indian power-sector operations expert and correct anything unrealistic. Carry over its stage names (sentence case), roles, priorities, 8 categories (adding `required_details`, `not_eligible` and `risk`), entities, KPIs and playbooks (body from the key points plus "Source: …"). Write fresh examples, 2 per category. Extend `sector-energy-heavy-industry` only. Its `match.keywords` must make "Thermal power station" match.
- **Power-plant test set:** `evals/suites/power-plant.yaml`, from the draft's `evalCases`, applying the inherited ₹5 lakh owner rule.

Iterate with `pnpm pack:check --pack packs/sector-energy-heavy-industry/pack.yaml` and `pnpm pack:check --pack packs/power-plant/pack.yaml --suite evals/suites/power-plant.yaml` until both print `✓`.

`checkSectorPack` accepts `closest: manufacturing-plant` and `construction` before those packs exist, because it checks the taxonomy, not the disk. `composeForSector` skips a closest type that isn't installed, so nothing breaks in between.

- [ ] **Step 7: Run all checks**

Run: `pnpm evals && pnpm turbo run build typecheck test`
Expected: `pnpm evals` shows `power-plant` meeting every threshold, and all tasks pass. `pack.test.ts` "loads every pack on disk" fails because its list is hard-coded. Change that assertion to `expect([...registry.keys()]).toEqual(expect.arrayContaining(['bookings-base', 'core-business', 'crm-base', 'orders-base', 'projects-base', 'travel-agency']))`. Task 4 replaces it with the taxonomy completeness test.

- [ ] **Step 8: Commit**

```bash
git add evals packs/sector-energy-heavy-industry packs/power-plant docs/packs.md package.json packages/agent-kit/src/pack.test.ts
git commit -m "feat(packs): pack check command, authoring guide, Energy sector and power plant packs"
```

---

### Task 4: The other 18 packs, their test sets, and the completeness tests

**Files:**
- Create: `packages/agent-kit/src/registry.test.ts`
- Modify: `evals/src/suites.test.ts`, `packages/agent-kit/src/pack.test.ts`
- Create: 4 `packs/sector-*/pack.yaml`; 13 `packs/<org type>/pack.yaml`; upgrade `packs/travel-agency/pack.yaml`; 14 `evals/suites/<org type>.yaml`; `.superpowers/research/municipal.draft.json`

**Interfaces:**
- Consumes: `ORG_TYPES`, `checkPackQuality`, `checkSectorPack` (Task 1); `composeForSector` (Task 2); `pnpm pack:check` and `docs/packs.md` (Task 3).

| Sector pack | Organization packs (extends) |
|---|---|
| `sector-energy-heavy-industry` (done in Task 3) | `power-plant` (done), `manufacturing-plant` (+ `orders-base`), `construction` (+ `projects-base`) |
| `sector-trade-logistics-tourism` | `logistics` (+ `orders-base`), `wholesale-retail` (+ `orders-base`), `travel-agency` (+ `bookings-base`; upgrade, keep everything) |
| `sector-finance-development` | `lender`, `accounting-firm` (+ `projects-base`), `ngo` (+ `projects-base`) |
| `sector-technology-innovation` | `software-saas` (+ `projects-base`), `it-services` (+ `projects-base`), `digital-agency` (+ `projects-base`) |
| `sector-public-services` | `hospital` (+ `bookings-base`), `education` (+ `bookings-base`), `municipal` |

- [ ] **Step 1: Write the failing completeness tests**

Create `packages/agent-kit/src/registry.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ORG_TYPES, SECTOR_IDS, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  applyPackUpdates,
  checkPackQuality,
  checkSectorPack,
  composeForSector,
  matchIndustry,
  packUpdates,
  parsePack,
  resolvePack,
  validatePackRefs,
} from './index';

const PACKS_DIR = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS_DIR)) {
  const file = join(PACKS_DIR, dir, 'pack.yaml');
  if (existsSync(file)) {
    const p = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(p.id, p);
  }
}
const lookup = (id: string) => registry.get(id);
const all = [...registry.values()];

describe('ready-made content', () => {
  it.each(SECTOR_IDS.map((s) => [s]))('sector %s has a complete base pack', (sector) => {
    const pack = registry.get(`sector-${sector}`);
    expect(pack, `packs/sector-${sector}/pack.yaml`).toBeDefined();
    expect(checkSectorPack(pack!)).toEqual([]);
    expect(validatePackRefs(resolvePack(pack!, lookup))).toEqual([]);
  });

  it.each(ORG_TYPES.map((t) => [t.id, t]))('%s is ready to offer', (id, type) => {
    const pack = registry.get(id);
    expect(pack, `packs/${id}/pack.yaml`).toBeDefined();
    expect(pack!.sector).toBe(type.sector);
    const resolved = resolvePack(pack!, lookup);
    expect(validatePackRefs(resolved)).toEqual([]);
    expect(checkPackQuality(resolved)).toEqual([]);
  });

  it('offers no sector-tagged pack outside the taxonomy', () => {
    const ids = new Set(ORG_TYPES.map((t) => t.id));
    expect(all.filter((p) => p.kind === 'industry' && p.sector && !ids.has(p.id)).map((p) => p.id)).toEqual([]);
  });
});

describe('ready-made packs now win for common types', () => {
  const industry = all.filter((p) => p.kind === 'industry');
  it.each([
    ['Dental clinic in Kochi', 'hospital'],
    ['NEET coaching institute', 'education'],
    ['Construction company', 'construction'],
    ['NBFC giving gold loans', 'lender'],
    ['Transport company with 40 trucks', 'logistics'],
    ['Thermal power station', 'power-plant'],
  ])('%s → %s', (text, id) => {
    expect(matchIndustry(text, industry)?.pack.id).toBe(id);
  });

  it('construction keeps the daily work report', () => {
    const construction = resolvePack(registry.get('construction')!, lookup);
    expect(construction.routines.map((r) => r.id)).toContain('daily-work-report');
  });
});

describe('typed-in types', () => {
  it.each([
    ['Cement plant in Andhra', 'energy-heavy-industry', 'manufacturing-plant'],
    ['Solar park operator', 'energy-heavy-industry', 'power-plant'],
    ['Cold storage chain', 'trade-logistics-tourism', 'logistics'],
    ['Insurance broker', 'finance-development', null],
    ['Diagnostic lab', 'public-services', 'hospital'],
  ] as const)('%s in %s builds on %s', (text, sector, expected) => {
    const c = composeForSector(text, sector, all);
    if (expected) expect(c.basedOn).toBe(expected);
    const resolved = resolvePack(c.pack, lookup, 'generated');
    expect(validatePackRefs(resolved)).toEqual([]);
    expect(resolved.lifecycle!.stages.every((s) => s.name.length > 0)).toBe(true);
  });
});

describe('travel agency upgrade', () => {
  it('upgrades a pre-lifecycle travel workspace cleanly', () => {
    const latest = resolvePack(registry.get('travel-agency')!, lookup);
    const { lifecycle: _drop, ...rest } = latest;
    const old = {
      ...rest,
      lineage: ['core-business', 'crm-base', 'bookings-base', 'travel-agency'],
      agents: rest.agents.filter((a) => a.role !== 'case-coordinator'),
      playbooks: [],
    } as ResolvedPack;
    const updates = packUpdates(old, latest);
    expect(updates.lifecycle.whole?.case.label).toBe(latest.lifecycle!.case.label);
    expect(validatePackRefs(applyPackUpdates(old, updates))).toEqual([]);
  });

  it('keeps every part it had before', () => {
    const travel = registry.get('travel-agency')!;
    expect(travel.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['Trip', 'Itinerary', 'Supplier']));
    expect(travel.agents.map((a) => a.role)).toEqual(expect.arrayContaining(['trip-intake', 'itinerary-planner', 'booking-coordinator']));
    expect(travel.workflows.map((w) => w.id)).toEqual(expect.arrayContaining(['new-enquiry', 'itinerary-to-booking', 'disruption-response']));
    expect(travel.policies.map((p) => p.id)).toEqual(expect.arrayContaining(['confirm-booking', 'refund-above-5000']));
  });
});
```

In `evals/src/suites.test.ts`, add after the `has at least one suite` test:

```ts
  it('every ready-made pack has a test set', () => {
    const withSuite = new Set(suites.map((s) => s.pack));
    const missing = [...registry.values()].filter((p) => p.kind === 'industry' && p.sector && !withSuite.has(p.id)).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it.each(suites.map((s) => [s.pack, s] as const))('%s keeps its examples out of the test set', (packId, suite) => {
    const resolved = resolvePack(registry.get(packId)!, (id) => registry.get(id));
    const examples = new Set((resolved.lifecycle?.examples ?? []).map((e) => normalizeText(e.request)));
    expect(suite.cases.filter((c) => examples.has(normalizeText(c.request))).map((c) => c.id)).toEqual([]);
  });
```

Add `normalizeText` to that file's `@onehuman/agent-kit` import.

In `packages/agent-kit/src/pack.test.ts`:
- Replace the `travel-agency inherits bookings and crm…` lineage expectation with `expect(travel.lineage).toEqual(['core-business', 'crm-base', 'sector-trade-logistics-tourism', 'bookings-base', 'travel-agency'])`.
- Replace `does not force a match for %s` (dental clinic, coaching institute, cloud kitchen) with `it.each(['cloud kitchen', 'pet grooming'])('does not force a match for %s', …)`. Dental clinics and coaching institutes now match ready-made packs, which `registry.test.ts` pins.

- [ ] **Step 2: Run the completeness tests to verify they fail**

Run: `pnpm --filter @onehuman/agent-kit exec vitest run src/registry.test.ts`
Expected: FAIL. Four sector packs and 13 organization packs are missing; `power-plant` and `sector-energy-heavy-industry` pass.

- [ ] **Step 3: Write the content with author agents, one workflow per sector**

Run one workflow per sector, Energy first, with at most 5 agents each:
- **Stage A** (not for Energy): one author writes `packs/sector-<id>/pack.yaml`.
- **Stage B:** one author per organization type, in parallel.
- **Stage C:** one verifier for the sector.

Every author works in `.superpowers/drafts/`, checks with `pnpm pack:check`, and copies the files into `packs/` and `evals/suites/` only when the check prints `✓`. Authors never run `pnpm build`, `pnpm install` or `turbo`, and never edit files outside their own pack and suite.

**Sector author brief** (Stage A):

```
You write the ONEHUMAN OS sector base pack packs/sector-<id>/pack.yaml for <sector name>.
Read docs/packs.md and packs/sector-energy-heavy-industry/pack.yaml (the reference), spec Appendix B (your stage names and case name) in docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md, and the research drafts of your three types: .superpowers/research/<ids>.draft.json.
Write: kind base, sector <id>, extends [crm-base]; the 8 sector stage names; the sector case name and prefix; 5-6 broad case types any organization in the sector has (keywords, priority, risk, department, approval role); sector roles; 3 sector playbooks (ids start with sector-); 4 KPIs; and 8-15 other_org_types (common organization types in the sector, their keywords, and the closest of <ids>). <Required similar types: those listed for your sector below.>
Check with pnpm pack:check --pack .superpowers/drafts/sector-<id>.pack.yaml until ✓, then copy it into packs/.
```

The completeness tests need these, so each brief must name its sector's line:
- **Trade:** similar type "cold storage" → logistics; `logistics` matches "Transport company with 40 trucks".
- **Finance:** `lender` matches "NBFC giving gold loans".
- **Public services:** similar type "diagnostic lab" → hospital; `hospital` matches "Dental clinic in Kochi"; `education` matches "NEET coaching institute".
- **Energy:** `construction` matches "Construction company".

**Author brief** (Stage B; substitute the type, sector, draft path, extends and reference packs, plus that type's required signup text from the list above):

```
You are an operations and compliance expert for <name> organizations in India, writing the ONEHUMAN OS pack for them.
Read: docs/packs.md (the rules), packs/sector-energy-heavy-industry/pack.yaml and packs/power-plant/pack.yaml (the reference shape), evals/suites/power-plant.yaml, packs/<sector pack>/pack.yaml (what you inherit), and the research draft .superpowers/research/<id>.draft.json.
1. Check the draft as an expert: fix anything unrealistic, unsafe or not how Indian <name> organizations work (approval roles, limits, SLAs, stage names). Note each correction.
2. Write .superpowers/drafts/<id>.pack.yaml: id <id>, sector <sector>, extends [<extends>], following docs/packs.md, carrying over the draft's stage names (sentence case), roles, priorities, categories (adding required_details, not_eligible and risk), entities, KPIs and playbooks. Write 2-3 fresh examples per category. <Extra: travel-agency keeps every existing entity, agent, tool, workflow, policy, KPI and routine and only adds; municipal has no draft, so research it first with at most 10 web searches and save .superpowers/research/municipal.draft.json in the same format as the others.>
3. Write .superpowers/drafts/<id>.suite.yaml from the draft's evalCases, applying the inherited rules (₹5 lakh owner rule, unknown amounts ask, named role first).
4. Run pnpm pack:check --pack .superpowers/drafts/<id>.pack.yaml --suite .superpowers/drafts/<id>.suite.yaml and fix until it prints ✓. Fix the pack the way the organization really works; change a test case only if the case itself was wrong, and say why.
5. Copy the two files to packs/<id>/pack.yaml and evals/suites/<id>.yaml and run the check once more on the final paths.
Return: the corrections you made to the draft, the final scorecard, and anything you are unsure of.
```

**Verifier brief:**

```
You are a senior reviewer for the <sector name> sector packs: <ids>. For each pack:
- Realism: would an Indian organization of this kind recognise its stage names, case types, approval roles, limits and response times?
- Safety: money, safety and legal work needs the right approver.
- Test honesty: the rules generalise (keyword families, not test sentences), the examples are fresh, and the expectations follow from the rules.
- Plain words throughout.
Fix problems directly in packs/<id>/pack.yaml and evals/suites/<id>.yaml, re-run pnpm pack:check on each until ✓, and report what you changed.
```

- [ ] **Step 4: Integrate**

Run: `pnpm build:packages && pnpm evals && pnpm --filter @onehuman/agent-kit exec vitest run`
Expected: `pnpm evals` passes every suite (core-business + 15), and the agent-kit tests pass, including `registry.test.ts`. Read each failure. Fix packs that miss the bar yourself, or with one more author run for that type.

- [ ] **Step 5: Run the full checks**

Run: `pnpm turbo run build typecheck test`
Expected: all successful. The backend's `offline.test.ts` uses travel-agency workflows that the upgrade kept.

- [ ] **Step 6: Commit**

```bash
git add packs evals/suites evals/src/suites.test.ts packages/agent-kit/src/registry.test.ts packages/agent-kit/src/pack.test.ts
git commit -m "feat(packs): five sector packs and fifteen ready-made organization packs with test sets"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md` ("What works today", the industry adaptation row and "How a pack works"), `evals/README.md`

- [ ] **Step 1: Update the README**

Rewrite the **Industry adaptation** row: the owner picks one of five sectors, then one of three ready-made types or types their own. A typed-in type borrows the closest ready-made type of that sector, or the sector's defaults. Each ready-made type has its own 8 stage names, case types, approval roles, playbooks and a scored test set. Add a line to "How a pack works" pointing to `docs/packs.md` and `pnpm pack:check`. In "Checks", add `pnpm evals` (scored test sets, also run in CI through the test task).

- [ ] **Step 2: Update `evals/README.md`**

List the suites (core-business plus 15 organization types), how to check a draft (`pnpm pack:check`), and the thresholds.

- [ ] **Step 3: Verify and commit**

Run: `pnpm turbo run build typecheck test`
Expected: all successful.

```bash
git add README.md evals/README.md
git commit -m "docs: sector content, pack authoring and evals"
```
