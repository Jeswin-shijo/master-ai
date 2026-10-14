import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { entityValidator } from '@onehuman/agent-kit';
import { changedFields, sampleRecord, seedOrder } from '../../../src/records/records.service';

const Contractor: EntityDef = { name: 'Contractor', label: 'Contractor', title_field: 'name', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const ContractorBill: EntityDef = {
  name: 'ContractorBill', label: 'Contractor bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: false },
    { name: 'contractor', label: 'Contractor', type: 'reference', ref: 'Contractor', required: true },
    { name: 'thisBill', label: 'This bill', type: 'money', required: true },
    { name: 'note', label: 'Note', type: 'text', required: false },
  ],
};
const A: EntityDef = { name: 'A', label: 'A', fields: [{ name: 'b', label: 'B', type: 'reference', ref: 'B', required: false }] };
const B: EntityDef = { name: 'B', label: 'B', fields: [{ name: 'a', label: 'A', type: 'reference', ref: 'A', required: false }] };

describe('sample data', () => {
  it('seeds a record type before the ones that point at it', () => {
    expect(seedOrder([ContractorBill, Contractor]).map((e) => e.name)).toEqual(['Contractor', 'ContractorBill']);
  });

  it('still seeds record types that point at each other, each once', () => {
    expect(seedOrder([A, B]).map((e) => e.name).sort()).toEqual(['A', 'B']);
  });

  it('fills a reference with a sample item of that type, and the result validates', () => {
    const data = sampleRecord(ContractorBill, 0, (name) => (name === 'Contractor' ? 'contractor-1' : undefined));
    expect(data.contractor).toBe('contractor-1');
    expect(entityValidator(ContractorBill).safeParse(data).success).toBe(true);
  });

  it('gives a required reference with nothing to point at a placeholder, so it validates', () => {
    const noRef: EntityDef = { name: 'T', label: 'Ticket', fields: [{ name: 'owner', label: 'Owner', type: 'reference', required: true }] };
    const noSamples: EntityDef = { name: 'U', label: 'Job', fields: [{ name: 'owner', label: 'Owner', type: 'reference', ref: 'Contractor', required: true }] };
    for (const e of [noRef, noSamples]) {
      const data = sampleRecord(e, 0, () => undefined);
      expect(typeof data.owner === 'string' && data.owner.length > 0).toBe(true);
      expect(entityValidator(e).safeParse(data).success).toBe(true);
    }
  });

  it('leaves an optional reference with nothing to point at empty', () => {
    const e: EntityDef = { name: 'T', label: 'Ticket', fields: [{ name: 'owner', label: 'Owner', type: 'reference', ref: 'Contractor', required: false }] };
    expect(sampleRecord(e, 0, () => undefined).owner).toBeNull();
  });
});

describe('changedFields', () => {
  it('lists only the fields whose value changed, treating blank and missing alike', () => {
    expect(changedFields(ContractorBill, { billNo: 'A', thisBill: 5, note: '' }, { billNo: 'A', thisBill: 6 })).toEqual([{ field: 'thisBill', from: 5, to: 6 }]);
  });
});
