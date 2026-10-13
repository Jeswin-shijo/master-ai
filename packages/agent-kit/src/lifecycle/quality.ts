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
