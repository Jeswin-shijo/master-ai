import { describe, expect, it } from 'vitest';
import { pushTarget } from '../../src/lib/push-target';

describe('tapping a push', () => {
  it('opens the list item a party answered about', () => {
    expect(pushTarget({ listId: 'bills', itemId: 'item-1' })).toEqual({ pathname: '/list/[id]/[itemId]', params: { id: 'bills', itemId: 'item-1' } });
  });

  it('opens the case, or the decision', () => {
    expect(pushTarget({ caseId: 'case-1' })).toEqual({ pathname: '/case/[id]', params: { id: 'case-1' } });
    expect(pushTarget({ approvalId: 'approval-1' })).toEqual({ pathname: '/approval/[id]', params: { id: 'approval-1' } });
  });

  it('just opens the app for anything else', () => {
    for (const data of [undefined, null, 'bills', 7, {}, { routineId: 'r1' }, { listId: 'bills' }, { listId: 7, itemId: 'item-1' }, { caseId: '' }]) {
      expect(pushTarget(data)).toBeNull();
    }
  });
});
