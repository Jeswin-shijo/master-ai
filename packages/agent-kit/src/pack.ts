import { z } from 'zod';
import {
  PackSchema,
  type EntityDef,
  type EntityField,
  type Pack,
  type PackInput,
  type PackSource,
  type PackUpdates,
  type ResolvedPack,
} from '@onehuman/schemas';
import { CASE_COORDINATOR_ROLE, getCatalogTool } from './catalog';
import { lifecyclePolicies, mergeLifecycles, validateLifecycle } from './lifecycle/resolve';

export class PackError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}:\n- ${issues.join('\n- ')}` : message);
  }
}

/** Parse untrusted pack data (YAML from disk, LLM output, tenant edits). */
export function parsePack(input: unknown): Pack {
  const result = PackSchema.safeParse(input);
  if (!result.success) {
    throw new PackError(
      'Invalid pack',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export type PackLookup = (id: string) => Pack | undefined;

/**
 * Flatten `extends` depth-first. Later packs override earlier ones by key:
 * entities by name, agents by role, tools by name, workflows/KPIs by id,
 * policies by id (or action + agent).
 */
export function resolvePack(pack: Pack, lookup: PackLookup, source: PackSource = 'registry'): ResolvedPack {
  const chain: Pack[] = [];
  const visiting = new Set<string>();
  const seen = new Set<string>();

  const visit = (p: Pack) => {
    if (seen.has(p.id)) return;
    if (visiting.has(p.id)) throw new PackError(`Pack inheritance cycle at ${p.id}`);
    visiting.add(p.id);
    for (const parentId of p.extends) {
      const parent = lookup(parentId);
      if (!parent) throw new PackError(`Pack ${p.id} extends unknown pack ${parentId}`);
      visit(parent);
    }
    visiting.delete(p.id);
    seen.add(p.id);
    chain.push(p);
  };
  visit(pack);

  const { lifecycle: _ownLifecycle, ...ownPack } = pack;
  const merged: Omit<Pack, 'lifecycle'> = { ...ownPack, entities: [], agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], connectors: [], labels: {} };
  const entities = new Map<string, EntityDef>();
  const agents = new Map<string, Pack['agents'][number]>();
  const tools = new Map<string, Pack['tools'][number]>();
  const workflows = new Map<string, Pack['workflows'][number]>();
  const routines = new Map<string, Pack['routines'][number]>();
  const policies = new Map<string, Pack['policies'][number]>();
  const kpis = new Map<string, Pack['kpis'][number]>();
  const connectors = new Set<string>();

  for (const p of chain) {
    p.entities.forEach((e) => entities.set(e.name, e));
    p.agents.forEach((a) => agents.set(a.role, a));
    p.tools.forEach((t) => tools.set(t.name, t));
    p.workflows.forEach((w) => workflows.set(w.id, { ...w, category: w.category ?? p.name }));
    (p.routines ?? []).forEach((r) => routines.set(r.id, r));
    p.policies.forEach((r) => policies.set(policyKey(r), r));
    p.kpis.forEach((k) => kpis.set(k.id, k));
    p.connectors.forEach((c) => connectors.add(c));
    Object.assign(merged.labels, p.labels);
  }

  const lifecycle = mergeLifecycles(chain.flatMap((p) => (p.lifecycle ? [p.lifecycle] : [])));
  // Derived gate policies; an explicit pack policy with the same id wins.
  for (const rule of lifecyclePolicies(lifecycle)) {
    if (!policies.has(policyKey(rule))) policies.set(policyKey(rule), rule);
  }
  merged.sector = [...chain].reverse().find((p) => p.sector)?.sector;

  merged.entities = [...entities.values()];
  merged.agents = [...agents.values()];
  merged.tools = [...tools.values()];
  merged.workflows = [...workflows.values()];
  merged.routines = [...routines.values()];
  merged.policies = [...policies.values()];
  merged.kpis = [...kpis.values()];
  merged.connectors = [...connectors];

  return applyLabels({ ...merged, lifecycle, lineage: chain.map((p) => p.id), source });
}

const policyKey = (r: Pack['policies'][number]) => r.id ?? `${r.action}:${r.agent ?? '*'}`;

/**
 * What `latest` (the current base packs, labelled for the workspace) has that an
 * installed pack lacks. Additions only: nothing the workspace already has, or the
 * owner changed, is replaced. Entities are left out because they shape stored
 * records, and anything that would point at a missing entity, tool or agent is
 * dropped so the result always passes `validatePackRefs`.
 */
export function packUpdates(installed: ResolvedPack, latest: ResolvedPack): PackUpdates {
  const missing = <T>(items: T[], have: T[], key: (x: T) => string) => {
    const keys = new Set(have.map(key));
    return items.filter((x) => !keys.has(key(x)));
  };
  const entities = new Set(installed.entities.map((e) => e.name));

  const tools = missing(latest.tools, installed.tools, (t) => t.name).filter((t) => {
    const entity = t.with?.entity;
    return typeof entity !== 'string' || entities.has(entity);
  });
  const toolNames = new Set([...installed.tools, ...tools].map((t) => t.name));
  const agents = missing(latest.agents, installed.agents, (a) => a.role).filter((a) =>
    a.tools.every((t) => !!getCatalogTool(t) || toolNames.has(t)),
  );
  const roles = new Set([...installed.agents, ...agents].map((a) => a.role));
  const workflows = missing(latest.workflows, installed.workflows, (w) => w.id).filter((w) => w.steps.every((s) => roles.has(s.agent)));
  const workflowIds = new Set([...installed.workflows, ...workflows].map((w) => w.id));

  let lifecycle: PackUpdates['lifecycle'] = { whole: null, categories: [], roles: [] };
  if (latest.lifecycle && !installed.lifecycle) {
    lifecycle = { whole: latest.lifecycle, categories: [], roles: [] };
  } else if (latest.lifecycle && installed.lifecycle) {
    lifecycle = {
      whole: null,
      categories: missing(latest.lifecycle.categories, installed.lifecycle.categories, (c) => c.id).filter((c) => !c.workflow || workflowIds.has(c.workflow)),
      roles: missing(latest.lifecycle.roles, installed.lifecycle.roles, (r) => r.id),
    };
  }
  const categoryIds = new Set([
    ...(lifecycle.whole?.categories ?? installed.lifecycle?.categories ?? []),
    ...lifecycle.categories,
  ].map((c) => c.id));

  return {
    agents,
    tools,
    workflows,
    routines: missing(latest.routines ?? [], installed.routines ?? [], (r) => r.id),
    policies: missing(latest.policies, installed.policies, policyKey).filter(
      (r) => (!r.agent || roles.has(r.agent)) && (r.when?.category ?? []).every((id) => categoryIds.has(id)),
    ),
    kpis: missing(latest.kpis, installed.kpis, (k) => k.id).filter((k) => k.source?.type !== 'records_count' || entities.has(k.source.entity)),
    lifecycle,
  };
}

export function emptyPackUpdates(): PackUpdates {
  return { agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], lifecycle: { whole: null, categories: [], roles: [] } };
}

export function countPackUpdates(u: PackUpdates): number {
  return (
    u.agents.length + u.tools.length + u.workflows.length + u.routines.length + u.policies.length + u.kpis.length +
    (u.lifecycle.whole ? 1 : 0) + u.lifecycle.categories.length + u.lifecycle.roles.length
  );
}

export function applyPackUpdates(installed: ResolvedPack, u: PackUpdates): ResolvedPack {
  const lifecycle = u.lifecycle.whole
    ? u.lifecycle.whole
    : installed.lifecycle && {
        ...installed.lifecycle,
        categories: [...installed.lifecycle.categories, ...u.lifecycle.categories],
        roles: [...installed.lifecycle.roles, ...u.lifecycle.roles],
      };
  return {
    ...installed,
    agents: [...installed.agents, ...u.agents],
    tools: [...installed.tools, ...u.tools],
    workflows: [...installed.workflows, ...u.workflows],
    routines: [...(installed.routines ?? []), ...u.routines],
    policies: [...installed.policies, ...u.policies],
    kpis: [...installed.kpis, ...u.kpis],
    ...(lifecycle && { lifecycle }),
  };
}

/** Rename shared terms for the sector, e.g. Customer → Patient, Booking → Appointment. */
export function applyLabels(pack: ResolvedPack): ResolvedPack {
  const pairs = Object.entries(pack.labels).filter(([from, to]) => from !== to);
  if (pairs.length === 0) return pack;

  const relabel = (text: string) =>
    pairs.reduce((acc, [from, to]) => replaceTerm(acc, from, to), text);

  return {
    ...pack,
    entities: pack.entities.map((e) => {
      const label = pack.labels[e.name] ?? relabel(e.label);
      return {
        ...e,
        label,
        plural_label: pack.labels[e.name] ? pluralize(label) : e.plural_label && relabel(e.plural_label),
        description: e.description && relabel(e.description),
        fields: e.fields.map((f) => ({ ...f, label: relabel(f.label) })),
      };
    }),
    agents: pack.agents.map((a) => ({
      ...a,
      name: relabel(a.name),
      description: relabel(a.description),
      instructions: a.instructions && relabel(a.instructions),
    })),
    workflows: pack.workflows.map((w) => ({
      ...w,
      name: relabel(w.name),
      description: relabel(w.description),
      steps: w.steps.map((s) => ({ ...s, title: relabel(s.title), instructions: relabel(s.instructions) })),
    })),
    routines: (pack.routines ?? []).map((r) => ({
      ...r,
      name: relabel(r.name),
      description: relabel(r.description),
      questions: r.questions.map((q) => ({ ...q, label: relabel(q.label), ask: relabel(q.ask) })),
    })),
    kpis: pack.kpis.map((k) => ({ ...k, name: relabel(k.name), description: relabel(k.description) })),
  };
}

function replaceTerm(text: string, from: string, to: string): string {
  const pattern = new RegExp(`\\b(${escapeRegex(from)})(s|es)?\\b`, 'gi');
  return text.replace(pattern, (match, word: string, plural?: string) => {
    let out = plural ? pluralize(to) : to;
    if (word[0] === word[0]!.toLowerCase()) out = out.toLowerCase();
    else if (word === word.toUpperCase() && word.length > 1) out = out.toUpperCase();
    return out;
  });
}

export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cross-reference checks that the schema alone cannot express. Generated packs
 * are fed these issues back so the model can repair them.
 */
export function validatePackRefs(pack: ResolvedPack): string[] {
  const issues: string[] = [];
  const entityNames = new Set(pack.entities.map((e) => e.name));
  const aliasNames = new Set(pack.tools.map((t) => t.name));
  const roles = new Set(pack.agents.map((a) => a.role));
  const toolExists = (name: string) => !!getCatalogTool(name) || aliasNames.has(name);

  for (const alias of pack.tools) {
    if (!getCatalogTool(alias.uses)) issues.push(`tool ${alias.name}: uses unknown primitive ${alias.uses}`);
    if (getCatalogTool(alias.name)) issues.push(`tool ${alias.name}: alias name collides with a catalog tool`);
    const entity = alias.with?.entity;
    if (typeof entity === 'string' && !entityNames.has(entity)) {
      issues.push(`tool ${alias.name}: unknown entity ${entity}`);
    }
  }
  for (const agent of pack.agents) {
    for (const tool of agent.tools) {
      if (!toolExists(tool)) issues.push(`agent ${agent.role}: unknown tool ${tool}`);
      else if (agent.role !== CASE_COORDINATOR_ROLE && resolveToolControl(pack, tool) === 'gate') {
        issues.push(`agent ${agent.role}: ${tool} is reserved for the case coordinator`);
      }
    }
  }
  for (const entity of pack.entities) {
    const fieldNames = new Set(entity.fields.map((f) => f.name));
    if (fieldNames.size !== entity.fields.length) issues.push(`entity ${entity.name}: duplicate field names`);
    if (entity.title_field && !fieldNames.has(entity.title_field)) {
      issues.push(`entity ${entity.name}: title_field ${entity.title_field} is not a field`);
    }
    for (const f of entity.fields) {
      if (f.type === 'enum' && !f.options?.length) issues.push(`entity ${entity.name}.${f.name}: enum needs options`);
      if (f.type === 'reference' && f.ref && !entityNames.has(f.ref)) {
        issues.push(`entity ${entity.name}.${f.name}: reference to unknown entity ${f.ref}`);
      }
    }
  }
  for (const wf of pack.workflows) {
    const keys = new Set(wf.steps.map((s) => s.key));
    for (const step of wf.steps) {
      if (!roles.has(step.agent)) issues.push(`workflow ${wf.id}.${step.key}: unknown agent role ${step.agent}`);
      for (const dep of step.depends_on) {
        if (!keys.has(dep)) issues.push(`workflow ${wf.id}.${step.key}: depends on unknown step ${dep}`);
      }
    }
  }
  const categoryIds = new Set((pack.lifecycle?.categories ?? []).map((c) => c.id));
  for (const rule of pack.policies) {
    if (rule.action !== '*' && !toolExists(rule.action)) issues.push(`policy on unknown tool ${rule.action}`);
    if (rule.agent && !roles.has(rule.agent)) issues.push(`policy on unknown agent role ${rule.agent}`);
    for (const id of rule.when?.category ?? []) {
      if (!categoryIds.has(id)) issues.push(`policy ${rule.id ?? rule.action}: unknown lifecycle category ${id}`);
    }
  }
  if (pack.lifecycle) issues.push(...validateLifecycle(pack.lifecycle, pack));
  for (const kpi of pack.kpis) {
    if (kpi.source?.type === 'records_count' && !entityNames.has(kpi.source.entity)) {
      issues.push(`kpi ${kpi.id}: unknown entity ${kpi.source.entity}`);
    }
  }
  return issues;
}

/** A tool's runtime control, looking through pack aliases to the primitive. */
function resolveToolControl(pack: ResolvedPack, name: string): string | undefined {
  const alias = pack.tools.find((t) => t.name === name);
  return getCatalogTool(alias ? alias.uses : name)?.control;
}

/** Build a Zod validator for records of one entity. Works in browser and server. */
export function entityValidator(entity: EntityDef) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of entity.fields) {
    const base = fieldSchema(field);
    shape[field.name] = field.required ? base : base.optional().nullable();
  }
  return z.object(shape).loose();
}

function fieldSchema(field: EntityField): z.ZodType {
  switch (field.type) {
    case 'number':
    case 'money':
      return z.coerce.number();
    case 'integer':
      return z.coerce.number().int();
    case 'boolean':
      return z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'expected YYYY-MM-DD');
    case 'datetime':
      return z.string().min(10);
    case 'email':
      return z.email();
    case 'enum':
      return field.options?.length ? z.enum(field.options as [string, ...string[]]) : z.string();
    case 'phone':
      return z.string().regex(/^[+\d][\d\s-]{5,}$/, 'expected a phone number');
    default:
      return z.string().min(field.required ? 1 : 0);
  }
}

/** JSON Schema for an entity, used by agents and the schema-driven UI. */
export function entityJsonSchema(entity: EntityDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of entity.fields) {
    const base: Record<string, unknown> = { title: f.label };
    if (f.description) base.description = f.description;
    switch (f.type) {
      case 'number':
      case 'money':
        properties[f.name] = { ...base, type: 'number' };
        break;
      case 'integer':
        properties[f.name] = { ...base, type: 'integer' };
        break;
      case 'boolean':
        properties[f.name] = { ...base, type: 'boolean' };
        break;
      case 'date':
        properties[f.name] = { ...base, type: 'string', format: 'date' };
        break;
      case 'datetime':
        properties[f.name] = { ...base, type: 'string', format: 'date-time' };
        break;
      case 'email':
        properties[f.name] = { ...base, type: 'string', format: 'email' };
        break;
      case 'enum':
        properties[f.name] = { ...base, type: 'string', enum: f.options ?? [] };
        break;
      default:
        properties[f.name] = { ...base, type: 'string' };
    }
  }
  return {
    type: 'object',
    title: entity.label,
    properties,
    required: entity.fields.filter((f) => f.required).map((f) => f.name),
  };
}

/** Convenience for YAML-authored packs. */
export function definePack(input: PackInput): Pack {
  return parsePack(input);
}
