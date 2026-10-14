import { ORG_TYPES } from '@onehuman/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListsService } from '../../src/lists/lists.service';
import { OnboardingService } from '../../src/tenancy/onboarding.service';
import { boot, newOrg, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await boot();
});
afterAll(() => h.close());

describe.each(ORG_TYPES.map((t) => t.id))('%s', (orgType) => {
  it('opens every list with each view, sort and filter, and downloads it', async () => {
    const org = await newOrg(h, orgType);
    const lists = h.get(ListsService);
    const overview = await lists.overview(org.tenantId);
    expect(overview.lists.some((l) => l.main)).toBe(true);
    for (const l of overview.lists) {
      const all = await lists.page(org.tenantId, l.id, { range: 'all' });
      expect(all.total, `${l.id} has its sample items`).toBeGreaterThan(0);
      for (const show of ['problems', 'not_checked', 'checked']) await lists.page(org.tenantId, l.id, { range: 'all', show });
      for (const column of l.columns) await lists.page(org.tenantId, l.id, { range: 'all', sort: `${column}:desc` });
      for (const name of l.filters) {
        const field = l.entity.fields.find((f) => f.name === name)!;
        const value = field.type === 'enum' ? field.options![0]! : field.type === 'boolean' ? 'true' : String(all.items[0]!.data[name] ?? '');
        if (value) await lists.page(org.tenantId, l.id, { range: 'all', [`f.${name}`]: value });
      }
      if (l.dateField) await lists.page(org.tenantId, l.id, {});
      await lists.exportCsv(org.tenantId, l.id, { range: 'all' });
    }
  });
});

describe('a company set up before these lists', () => {
  it('gets the new record type and lists from the update banner, and they open', async () => {
    const org = await newOrg(h, 'it-services');
    await h.owner.query(
      `update workspaces set pack = jsonb_set(pack - 'registers', '{entities}',
         (select jsonb_agg(e) from jsonb_array_elements(pack->'entities') e where e->>'name' <> 'Ticket')) where id = $1`,
      [org.workspaceId],
    );
    const onboarding = h.get(OnboardingService);
    const updates = await onboarding.updates(org.tenantId, org.workspaceId);
    expect(updates.entities.map((e) => e.name)).toEqual(['Ticket']);
    expect(updates.registers.map((r) => r.id)).toEqual(expect.arrayContaining(['tickets', 'incidents', 'assets', 'contracts']));
    await onboarding.applyUpdates(org.session, org.workspaceId);
    const lists = h.get(ListsService);
    expect((await lists.overview(org.tenantId)).lists.filter((l) => l.main).map((l) => l.id)).toEqual(['tickets', 'incidents', 'assets', 'contracts']);
    await expect(lists.page(org.tenantId, 'tickets', { range: 'all' })).resolves.toMatchObject({ list: { id: 'tickets' } });
  });
});
