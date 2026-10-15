import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { FieldTypeSchema, ORG_TYPES, SECTORS, type Pack, type ResolvedPack, type SectorId } from '@onehuman/schemas';
import {
  composeForSector,
  composeOfflinePack,
  defaultRegisterId,
  matchIndustry,
  normalizeIndustry,
  PackError,
  parsePack,
  TOOL_CATALOG,
  fittingRegisters,
  fittingRoutines,
  validatePackRefs,
} from '@onehuman/agent-kit';
import { LlmService } from '../llm/llm.service';
import { PackRegistry } from './registry.service';

export interface GeneratedDraft {
  pack: ResolvedPack;
  source: 'registry' | 'generated';
  generator: 'registry' | 'llm' | 'offline-template';
  rationale: string;
}

/**
 * Model-facing pack format: flat, every field required (nullable when
 * optional), so it works with strict structured outputs. Mapped to the real
 * Pack format in `toPack`.
 */
const nullableString = z.string().nullable();
const GenPackSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  extends: z.array(z.string()),
  labels: z.array(z.strictObject({ from: z.string(), to: z.string() })),
  entities: z.array(
    z.strictObject({
      name: z.string(),
      label: z.string(),
      description: z.string(),
      title_field: z.string(),
      fields: z.array(
        z.strictObject({
          name: z.string(),
          label: z.string(),
          type: FieldTypeSchema,
          required: z.boolean(),
          options: z.array(z.string()).nullable(),
        }),
      ),
    }),
  ),
  /** Up to four of this pack's own entity names the head most needs to see as lists (bills, tickets, site issues…). */
  main_lists: z.array(z.string()),
  tools: z.array(
    z.strictObject({
      name: z.string(),
      description: z.string(),
      uses: z.enum(TOOL_CATALOG.map((t) => t.name) as [string, ...string[]]),
      entity: nullableString,
      set_status: nullableString,
      level: z.number().int().nullable(),
      external_reach: z.boolean(),
      reversible: z.boolean(),
    }),
  ),
  agents: z.array(
    z.strictObject({
      role: z.string(),
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
      autonomy: z.number().int(),
      tools: z.array(z.string()),
      tier: z.enum(['frontier', 'standard', 'small']),
      data_class: z.enum(['public', 'internal', 'confidential', 'restricted']),
    }),
  ),
  workflows: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      keywords: z.array(z.string()),
      steps: z.array(
        z.strictObject({
          key: z.string(),
          title: z.string(),
          agent: z.string(),
          depends_on: z.array(z.string()),
          instructions: z.string(),
        }),
      ),
    }),
  ),
  policies: z.array(
    z.strictObject({
      id: z.string(),
      action: z.string(),
      kind: z.enum(['require_approval', 'require_approval_above', 'forbid', 'forbid_above']),
      amount_inr: z.number().nullable(),
      reason: z.string(),
    }),
  ),
  kpis: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      unit: z.enum(['count', 'percent', 'minutes', 'hours', 'inr']),
      direction: z.enum(['up', 'down']),
      target: z.number().nullable(),
      count_entity: nullableString,
      count_where_field: nullableString,
      count_where_value: nullableString,
    }),
  ),
  connectors: z.array(z.string()),
});
type GenPack = z.infer<typeof GenPackSchema>;

const GEN_JSON_SCHEMA = (() => {
  const s = z.toJSONSchema(GenPackSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const SYSTEM = `You design Industry Packs for ONEHUMAN OS, an operating system where AI agents run a business's operations under the owner's supervision.

A pack turns one industry into configuration: the business's records (entities), agent roles with the tools they may use, step-by-step workflows, approval policies and KPIs. The platform core never changes per industry.

How to design a good pack:
- Build on the base packs listed below through "extends" and only add what this industry needs on top. Do not repeat entities, agents or tools the base packs already provide; you may override a base agent by reusing its role id.
- Use "labels" to rename shared entities into the industry's words (for example Customer -> Patient, Booking -> Appointment).
- Entities: PascalCase names, camelCase field names, 4-10 fields each. Field types: string, text, number, integer, boolean, date, datetime, email, phone, money, enum (with options), reference.
- Main lists: in "main_lists", name up to 4 of your own entities (by name) that the head of the organization most needs to see as lists to check, for example bills, tickets or site issues.
- Tools: agents may only use catalog primitives or tool aliases you define. An alias wraps one primitive and can pin an entity and a status value (for example "lab.order_test" uses records.create on entity LabOrder). Mark external_reach and reversible honestly.
- Agents: 2-4 industry agents with clear, narrow roles. autonomy is the highest level the agent may act at without approval: 1 observe, 2 draft and recommend, 3 act within limits, 4 may propose actions that need approval. Give money-moving agents autonomy 4.
- Policies: require approval for anything irreversible, anything that commits the business to a customer or supplier, and money above sensible thresholds in INR for a small Indian business. Use forbid_above for hard limits. Regulated work (medical, legal, financial advice) must always require approval by a professional.
- Workflows: 2-4 common jobs in this industry, each a few steps assigned to agent roles, with depends_on between step keys.
- KPIs: 3-6, using count_entity/count_where_* when a KPI is a count of records.
- All ids are lowercase-with-dashes. Tool names are dotted lowercase (domain.action).`;

export interface Setup {
  /** chosen: the ready-made type picked at signup. ready-made: found in the owner's words. similar / sector: composed. */
  via: 'chosen' | 'ready-made' | 'similar' | 'sector';
  /** The pack the setup builds on. */
  basedOn: string;
  /** A composed pack extending `basedOn`, for when a ready-made pack is not used as is. */
  pack: Pack;
}

/** What a signup gets, inside its chosen sector. Null for companies created before sectors. */
export function pickSetup(input: { industry: string; sector: SectorId | null; orgType: string | null }, packs: Pack[]): Setup | null {
  if (!input.sector) return null;
  const composed = composeForSector(input.industry, input.sector, packs);
  const chosen = ORG_TYPES.find((t) => t.id === input.orgType && t.sector === input.sector);
  if (chosen && packs.some((p) => p.id === chosen.id)) {
    return { via: 'chosen', basedOn: chosen.id, pack: { ...composed.pack, extends: [chosen.id] } };
  }
  return { via: composed.via, basedOn: composed.basedOn, pack: composed.pack };
}

/** Turns an owner's industry text into an installable pack draft. */
@Injectable()
export class PackGenerator {
  private readonly logger = new Logger(PackGenerator.name);

  constructor(
    private readonly registry: PackRegistry,
    private readonly llm: LlmService,
  ) {}

  async draft(
    tenantId: string,
    industry: string,
    opts: { sector?: SectorId | null; orgType?: string | null; forceGenerate?: boolean } = {},
  ): Promise<GeneratedDraft> {
    const setup = pickSetup({ industry, sector: opts.sector ?? null, orgType: opts.orgType ?? null }, this.registry.list());
    if (setup) {
      if ((setup.via === 'chosen' || setup.via === 'ready-made') && !opts.forceGenerate) return this.readyMade(this.registry.get(setup.basedOn)!);
      if (this.llm.mode === 'online') {
        try {
          return await this.generateWithModel(tenantId, industry, { basedOn: setup.basedOn, sector: opts.sector! });
        } catch (err) {
          this.logger.warn(`Model pack generation failed, using the sector composer: ${(err as Error).message}`);
        }
      }
      const pack = this.registry.resolve(setup.pack, 'generated');
      const base = this.registry.get(setup.basedOn)!;
      const sectorName = SECTORS.find((s) => s.id === opts.sector)?.name ?? 'sector';
      const start = setup.via === 'sector' ? `with the ${sectorName} defaults` : `starting from the ready-made ${base.name.toLowerCase()} setup`;
      return {
        pack,
        source: 'generated',
        generator: 'offline-template',
        rationale: `Set up for "${industry}" ${start}. It keeps track of ${keeps(pack)}${yourWords(pack)}.`,
      };
    }

    // Companies created before sectors: match across every pack, as before.
    const match = opts.forceGenerate ? null : matchIndustry(industry, this.registry.industryPacks());
    if (match) return this.readyMade(match.pack);
    if (this.llm.mode === 'online') {
      try {
        return await this.generateWithModel(tenantId, industry);
      } catch (err) {
        this.logger.warn(`Model pack generation failed, using offline composer: ${(err as Error).message}`);
      }
    }
    const pack = this.registry.resolve(composeOfflinePack(industry), 'generated');
    return {
      pack,
      source: 'generated',
      generator: 'offline-template',
      rationale: `Set up for "${industry}" with what most businesses need: it keeps track of ${keeps(pack)}${yourWords(pack)}.`,
    };
  }

  private readyMade(pack: Pack): GeneratedDraft {
    const resolved = this.registry.resolve(pack);
    return {
      pack: resolved,
      source: 'registry',
      generator: 'registry',
      rationale: `A ready-made setup for ${pack.name.toLowerCase()}. It keeps track of ${keeps(resolved)}.`,
    };
  }

  private async generateWithModel(tenantId: string, industry: string, base?: { basedOn: string; sector: SectorId }): Promise<GeneratedDraft> {
    const context = this.contextForModel();
    let issues: string[] = [];
    let previous: GenPack | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const user = [
        `Design an Industry Pack for this business: "${industry}".`,
        base ? `This organization is in the ${SECTORS.find((s) => s.id === base.sector)?.name} sector. Build on "${base.basedOn}": the platform adds it to extends for you.` : '',
        context,
        previous
          ? `Your previous draft had these problems. Return the complete corrected pack.\n- ${issues.join('\n- ')}\n\nPrevious draft:\n${JSON.stringify(previous)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const result = await this.llm.complete({
        tenantId,
        purpose: 'pack_generate',
        tier: 'frontier',
        fallbackTier: 'standard',
        dataClass: 'internal',
        system: SYSTEM,
        user,
        jsonSchema: GEN_JSON_SCHEMA,
        effort: 'high',
        maxTokens: 32000,
        offline: () => ({}),
      });

      const parsed = GenPackSchema.safeParse(result.json);
      if (!parsed.success) {
        issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
        continue;
      }
      previous = parsed.data;
      try {
        const draftPack = this.toPack(industry, parsed.data);
        const shaped = base ? { ...draftPack, sector: base.sector, extends: [base.basedOn, ...draftPack.extends.filter((id) => id !== base.basedOn)] } : draftPack;
        const resolvedPack = this.registry.resolve(shaped, 'generated');
        // Lists inherited from the base type that no longer fit a record type the model redefined are left out.
        const fitted = { ...resolvedPack, registers: fittingRegisters(resolvedPack) };
        const pack = { ...fitted, routines: fittingRoutines(fitted) };
        issues = validatePackRefs(pack);
        if (issues.length === 0) {
          return {
            pack,
            source: 'generated',
            generator: 'llm',
            rationale: `Designed by AI for "${industry}". It keeps track of ${keeps(pack)}${yourWords(pack)}.`,
          };
        }
      } catch (err) {
        issues = err instanceof PackError && err.issues.length ? err.issues : [(err as Error).message];
      }
    }
    throw new Error(`generated pack still invalid: ${issues.slice(0, 5).join('; ')}`);
  }

  private contextForModel(): string {
    const tools = TOOL_CATALOG.map((t) => `- ${t.name}: ${t.description}`).join('\n');
    const bases = this.registry
      .basePacks()
      .map((b) => {
        const resolved = this.registry.resolve(b);
        return [
          `### ${b.id}: ${b.description}`,
          `entities: ${resolved.entities.map((e) => `${e.name}(${e.fields.map((f) => f.name).join(', ')})`).join('; ') || 'none'}`,
          `agents: ${resolved.agents.map((a) => `${a.role} [${a.tools.join(', ')}]`).join('; ')}`,
          `tool aliases: ${resolved.tools.map((t) => t.name).join(', ') || 'none'}`,
        ].join('\n');
      })
      .join('\n\n');
    return `## Catalog tools\n${tools}\n\n## Base packs (choose any for "extends")\n${bases}`;
  }

  private toPack(industry: string, g: GenPack): Pack {
    const slug = normalizeIndustry(industry).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'business';
    const baseIds = new Set(this.registry.basePacks().map((b) => b.id));
    return parsePack({
      id: /^[a-z]/.test(slug) ? `${slug}-pack` : `pack-${slug}`,
      version: '0.1.0',
      name: g.name,
      description: g.description,
      kind: 'industry',
      match: { keywords: [industry, ...g.keywords] },
      extends: g.extends.filter((id) => baseIds.has(id)),
      labels: Object.fromEntries(g.labels.map((l) => [l.from, l.to])),
      entities: g.entities.map((e) => ({
        name: e.name,
        label: e.label,
        description: e.description,
        title_field: e.title_field,
        fields: e.fields.map((f) => ({ ...f, options: f.options ?? undefined })),
      })),
      registers: mainListRegisters(g.entities.map((e) => e.name), g.main_lists),
      tools: g.tools.map((t) => ({
        name: t.name,
        description: t.description,
        uses: t.uses,
        with:
          t.entity || t.set_status
            ? {
                ...(t.entity && { entity: t.entity }),
                ...(t.set_status && t.uses === 'records.update' && { patch: { status: t.set_status } }),
                ...(t.set_status && t.uses === 'records.create' && { data: { status: t.set_status } }),
              }
            : undefined,
        level: t.level && t.level >= 1 && t.level <= 4 ? t.level : undefined,
        risk: { external_reach: t.external_reach, reversible: t.reversible },
      })),
      agents: g.agents.map((a) => ({
        role: a.role,
        name: a.name,
        description: a.description,
        instructions: a.instructions || undefined,
        autonomy: Math.min(4, Math.max(1, a.autonomy)),
        tools: a.tools,
        model: { tier: a.tier, fallback: a.tier === 'small' ? undefined : 'small', data_class: a.data_class },
      })),
      workflows: g.workflows,
      policies: g.policies.map((p) => ({
        id: p.id,
        action: p.action,
        reason: p.reason,
        ...(p.kind === 'require_approval' && { require_approval: true }),
        ...(p.kind === 'forbid' && { forbid: true }),
        ...(p.kind === 'require_approval_above' && { require_approval_above: { amount: p.amount_inr ?? 0 } }),
        ...(p.kind === 'forbid_above' && { forbid_above: { amount: p.amount_inr ?? 0 } }),
      })),
      kpis: g.kpis.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description,
        unit: k.unit,
        direction: k.direction,
        target: k.target ?? undefined,
        source: k.count_entity
          ? {
              type: 'records_count',
              entity: k.count_entity,
              where: k.count_where_field && k.count_where_value ? { [k.count_where_field]: k.count_where_value } : undefined,
            }
          : undefined,
      })),
      connectors: g.connectors,
    });
  }
}

/** The model's main lists → lists with default settings, for its own record types only, at most four. */
export function mainListRegisters(ownEntities: string[], mainLists: string[]): { id: string; entity: string; main: true }[] {
  const own = new Set(ownEntities);
  return [...new Set(mainLists)]
    .filter((name) => own.has(name))
    .slice(0, 4)
    .map((name) => ({ id: defaultRegisterId(name), entity: name, main: true as const }));
}

/** "clients, enquiries, projects and milestones" */
function keeps(pack: ResolvedPack): string {
  const names = pack.entities.map((e) => (e.plural_label ?? `${e.label}s`).toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'your records');
}

/** ", using your words (Clients, not Customers)" when the sector renames shared terms. */
function yourWords(pack: ResolvedPack): string {
  const renamed = Object.entries(pack.labels).filter(([from, to]) => from !== to).slice(0, 2);
  return renamed.length ? `, using your words (${renamed.map(([from, to]) => `${to}, not ${from}`).join('; ')})` : '';
}
