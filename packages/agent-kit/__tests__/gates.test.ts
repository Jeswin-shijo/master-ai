import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { ResolvedPack } from '@onehuman/schemas';
import { amountOf, CASE_COORDINATOR_ROLE, GATE_TOOLS, parsePack, prepareArgs, resolvePack, resolveTool, validatePackRefs } from '../src/index';

const core = parsePack(parse(readFileSync(join(__dirname, '../../../packs/core-business/pack.yaml'), 'utf8')));
const resolved = resolvePack(core, () => undefined);

describe('gate tools', () => {
  it('are catalog tools marked as gates', () => {
    for (const name of GATE_TOOLS) {
      const tool = resolveTool(resolved, name)!;
      expect(tool.primitive.control).toBe('gate');
      expect(tool.baseLevel).toBe(3);
    }
  });

  it('carry the case amount to the policy engine', () => {
    const tool = resolveTool(resolved, 'case.proceed')!;
    const args = { caseId: 'c1', category: 'breakdown', priority: 'P1', risk: 'high', amount: 45000, summary: 'Repair pump B' };
    expect(prepareArgs(tool, args).ok).toBe(true);
    expect(amountOf(tool, args)).toBe(45000);
    expect(amountOf(tool, { ...args, amount: undefined })).toBeNull();
  });

  it('belong to the case coordinator in core-business', () => {
    const coordinator = resolved.agents.find((a) => a.role === CASE_COORDINATOR_ROLE)!;
    expect(coordinator.tools).toEqual(expect.arrayContaining([...GATE_TOOLS]));
    expect(validatePackRefs(resolved)).toEqual([]);
  });

  it('refuses gate tools for any role but the case coordinator', () => {
    const rogue: ResolvedPack = {
      ...resolved,
      agents: [...resolved.agents, { ...resolved.agents[0]!, role: 'sneaky-agent', tools: ['records.search', 'case.proceed'] }],
    };
    expect(validatePackRefs(rogue)).toContain('agent sneaky-agent: case.proceed is reserved for the case coordinator');
  });
});
