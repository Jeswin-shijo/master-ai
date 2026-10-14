import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { fittingRegisters, parsePack, resolvePack, validatePackRefs } from '@onehuman/agent-kit';
import { pickSetup } from '../../../src/packs/generator.service';

const PACKS = join(__dirname, '../../../../packs');
const packs: Pack[] = readdirSync(PACKS)
  .map((dir) => join(PACKS, dir, 'pack.yaml'))
  .filter((file) => existsSync(file))
  .map((file) => parsePack(parse(readFileSync(file, 'utf8'))));

describe('signup setup', () => {
  it('uses the ready-made type the owner chose', () => {
    expect(pickSetup({ industry: 'Eye hospital chain', sector: 'public-services', orgType: 'hospital' }, packs)).toMatchObject({ via: 'chosen', basedOn: 'hospital' });
  });

  it('ignores a ready-made type from another sector', () => {
    expect(pickSetup({ industry: 'Microfinance', sector: 'public-services', orgType: 'lender' }, packs)?.basedOn).not.toBe('lender');
  });

  it("finds a ready-made type in the owner's words, inside the sector", () => {
    expect(pickSetup({ industry: 'Multispeciality hospital in Kochi', sector: 'public-services', orgType: null }, packs)).toMatchObject({ via: 'ready-made', basedOn: 'hospital' });
  });

  it('composes a typed-in type on the sector defaults', () => {
    const setup = pickSetup({ industry: 'Insurance broker in Pune', sector: 'finance-development', orgType: null }, packs)!;
    expect(setup).toMatchObject({ via: 'sector', basedOn: 'sector-finance-development' });
    expect(setup.pack.extends).toEqual(['sector-finance-development']);
    expect(setup.pack.sector).toBe('finance-development');
  });

  it('keeps typed-in types inside the chosen sector', () => {
    expect(pickSetup({ industry: 'Mutual fund distributor', sector: 'finance-development', orgType: null }, packs)!.basedOn).not.toBe('wholesale-retail');
  });

  it('leaves companies without a sector to the old matching', () => {
    expect(pickSetup({ industry: 'Travel agency', sector: null, orgType: null }, packs)).toBeNull();
  });
});

describe('a designed type that redefines a record type it inherits', () => {
  it('drops inherited lists that no longer fit and then passes the checks', () => {
    const own = parsePack({
      id: 'own', version: '1.0.0', name: 'Own', description: 'Own', extends: ['it-services'],
      entities: [{ name: 'Ticket', label: 'Ticket', title_field: 'summary', fields: [{ name: 'summary', label: 'Summary', type: 'string', required: true }] }],
    });
    const lookup = (id: string) => packs.find((p) => p.id === id);
    const resolved = resolvePack(own, lookup);
    expect(validatePackRefs(resolved).some((i) => i.startsWith('register tickets'))).toBe(true);
    const fitted = { ...resolved, registers: fittingRegisters(resolved) };
    expect(fitted.registers.some((r) => r.id === 'tickets')).toBe(false);
    expect(validatePackRefs(fitted)).toEqual([]);
  });
});
