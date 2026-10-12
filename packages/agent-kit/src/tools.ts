import { z } from 'zod';
import type { ResolvedPack, ToolAlias } from '@onehuman/schemas';
import { FINISH_TOOL, getCatalogTool, type CatalogTool, type ToolRisk } from './catalog';

/** A tool as one agent sees it: a catalog primitive plus any pack alias layer. */
export interface ResolvedTool {
  name: string;
  description: string;
  primitive: CatalogTool;
  /** Arguments the pack fixes; merged over whatever the agent sends. */
  fixedArgs: Record<string, unknown>;
  baseLevel: 1 | 2 | 3 | 4;
  risk: ToolRisk;
  alias?: ToolAlias;
}

export function resolveTool(pack: ResolvedPack, name: string): ResolvedTool | undefined {
  const alias = pack.tools.find((t) => t.name === name);
  if (alias) {
    const primitive = getCatalogTool(alias.uses);
    if (!primitive) return undefined;
    const risk: ToolRisk = {
      ...primitive.risk,
      ...(alias.risk?.external_reach !== undefined && { externalReach: alias.risk.external_reach }),
      ...(alias.risk?.reversible !== undefined && { reversible: alias.risk.reversible }),
      ...(alias.risk?.moves_money !== undefined && { movesMoney: alias.risk.moves_money }),
      ...(alias.risk?.sensitivity !== undefined && { sensitivity: alias.risk.sensitivity }),
    };
    if (risk.externalReach && risk.category === 'write') risk.category = 'external';
    return {
      name: alias.name,
      description: alias.description,
      primitive,
      fixedArgs: alias.with ?? {},
      baseLevel: Math.max(primitive.baseLevel, alias.level ?? 1) as ResolvedTool['baseLevel'],
      risk,
      alias,
    };
  }
  const primitive = getCatalogTool(name);
  if (!primitive) return undefined;
  return {
    name,
    description: primitive.description,
    primitive,
    fixedArgs: {},
    baseLevel: primitive.baseLevel,
    risk: primitive.risk,
  };
}

/** Merge the agent's arguments with the pack's fixed ones (fixed wins, objects deep-merge). */
export function mergeArgs(agentArgs: Record<string, unknown>, fixed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...agentArgs };
  for (const [key, value] of Object.entries(fixed)) {
    const current = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(current)
        ? mergeArgs(current, value)
        : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate and normalise a proposed call: merge fixed args, then parse with the
 * primitive's schema. Returns readable issues instead of throwing so the agent
 * can correct itself.
 */
export function prepareArgs(
  tool: ResolvedTool,
  proposed: Record<string, unknown>,
): { ok: true; args: Record<string, unknown> } | { ok: false; issues: string[] } {
  const merged = mergeArgs(proposed ?? {}, tool.fixedArgs);
  const parsed = tool.primitive.input.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`),
    };
  }
  return { ok: true, args: parsed.data as Record<string, unknown> };
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Tool names must match ^[a-zA-Z0-9_-]{1,64}$ for most model APIs, so dots become `__`. */
export function toWireName(name: string): string {
  return name.replace(/\./g, '__');
}

export function fromWireName(name: string): string {
  return name.replace(/__/g, '.');
}

/** JSON Schema for the model, with pack-fixed top-level arguments removed. */
export function toolDefinition(tool: ResolvedTool): LlmToolDefinition {
  const schema = z.toJSONSchema(tool.primitive.input, { io: 'input' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
  delete schema.$schema;
  const fixedKeys = Object.keys(tool.fixedArgs).filter((k) => !isPlainObject(tool.fixedArgs[k]));
  if (schema.properties) {
    for (const key of fixedKeys) delete schema.properties[key];
  }
  if (schema.required) schema.required = schema.required.filter((k) => !fixedKeys.includes(k));

  let description = tool.description;
  const entity = tool.fixedArgs.entity;
  if (typeof entity === 'string') description += ` (entity: ${entity})`;
  return { name: toWireName(tool.name), description, input_schema: schema };
}

export function finishToolDefinition(): LlmToolDefinition {
  const schema = z.toJSONSchema(FINISH_TOOL.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: toWireName(FINISH_TOOL.name), description: FINISH_TOOL.description, input_schema: schema };
}

/** The tools one agent role may use, resolved against its pack. Unknown names are skipped. */
export function toolsForAgent(pack: ResolvedPack, toolNames: string[]): ResolvedTool[] {
  return toolNames.map((n) => resolveTool(pack, n)).filter((t): t is ResolvedTool => !!t);
}

/** Pull a money amount out of tool arguments, if the tool moves money. */
export function amountOf(tool: ResolvedTool, args: Record<string, unknown>): number | null {
  if (!tool.risk.movesMoney) return null;
  const raw = args.amount;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
