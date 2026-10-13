import { describe, expect, it } from 'vitest';
import { applyPackUpdates, countPackUpdates, packUpdates, parsePack, resolvePack } from './index';

const body = (topic: string) => `${topic}: who does what, in which order, which records to keep and when to tell the owner. `.repeat(2);
const pack = (playbooks: { id: string; title: string; body: string }[]) =>
  resolvePack(parsePack({ id: 'demo', version: '1.0.0', name: 'Demo', description: 'Demo pack', playbooks }), () => undefined);

describe('playbooks in pack updates', () => {
  it('offers playbooks the workspace lacks, and adds them', () => {
    const one = { id: 'refunds', title: 'Refunds', body: body('Refunds') };
    const two = { id: 'disruptions', title: 'Flight disruptions', body: body('Disruptions') };
    const installed = pack([one]);
    const u = packUpdates(installed, pack([one, two]));
    expect(u.playbooks.map((p) => p.id)).toEqual(['disruptions']);
    expect(countPackUpdates(u)).toBe(1);
    expect(applyPackUpdates(installed, u).playbooks.map((p) => p.id)).toEqual(['refunds', 'disruptions']);
  });
});
