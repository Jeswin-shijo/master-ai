import { describe, expect, it } from 'vitest';
import { mainListRegisters } from '../../../src/packs/generator.service';

describe("the model's main lists", () => {
  it("become lists of the pack's own record types, at most four, each once", () => {
    expect(mainListRegisters(['LabOrder', 'Sample', 'Invoice', 'Doctor', 'Bed'], ['LabOrder', 'Customer', 'LabOrder', 'Invoice', 'Sample', 'Doctor', 'Bed'])).toEqual([
      { id: 'lab-order', entity: 'LabOrder', main: true },
      { id: 'invoice', entity: 'Invoice', main: true },
      { id: 'sample', entity: 'Sample', main: true },
      { id: 'doctor', entity: 'Doctor', main: true },
    ]);
  });

  it('gives none when the model names none of its own', () => {
    expect(mainListRegisters(['LabOrder'], ['Customer'])).toEqual([]);
  });
});
