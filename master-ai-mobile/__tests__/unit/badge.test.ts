import { describe, expect, it, vi } from 'vitest';
import { contrastRatio, darkPalette } from '@onehuman/ui';

vi.mock('../../src/lib/session', () => ({ useSession: { getState: () => ({}) } }));
const { tabBadge } = await import('../../src/lib/theme');

describe('the Approvals badge', () => {
  it('is warm, because a person is needed, and its count reads at AA', () => {
    const badge = tabBadge(darkPalette);
    expect(badge.backgroundColor).toBe(darkPalette.warning);
    expect(contrastRatio(badge.color, badge.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});
