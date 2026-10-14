import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BulkCheckInputSchema, CheckListItemInputSchema, RemoveListItemInputSchema, UpdateListItemInputSchema } from '../src/lists';

describe('list inputs', () => {
  it('needs a reason to remove an item', () => {
    expect(RemoveListItemInputSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(RemoveListItemInputSchema.parse({ reason: ' Entered twice ' }).reason).toBe('Entered twice');
  });

  it('checks up to 500 items by id at once', () => {
    expect(BulkCheckInputSchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false);
    expect(BulkCheckInputSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(BulkCheckInputSchema.safeParse({ ids: Array.from({ length: 501 }, () => randomUUID()) }).success).toBe(false);
  });

  it('trims notes, and leaves out an empty one', () => {
    expect(UpdateListItemInputSchema.parse({ data: { total: 5 }, note: '  rounded  ' }).note).toBe('rounded');
    expect(CheckListItemInputSchema.parse({ note: '   ' }).note).toBeUndefined();
  });
});
