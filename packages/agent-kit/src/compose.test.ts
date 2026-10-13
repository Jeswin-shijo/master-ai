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
