import { describe, expect, it } from 'vitest';
import { gateStep } from './gate-step';

describe('opening a gate', () => {
  it('holds while a kill switch is on, whatever the policy says', () => {
    // Paused tenants make the policy engine answer Level 5; that must not end the case.
    expect(gateStep(true, 5)).toBe('paused');
    expect(gateStep(true, 4)).toBe('paused');
  });

  it('follows the policy level otherwise', () => {
    expect(gateStep(false, 2)).toBe('not_required');
    expect(gateStep(false, 3)).toBe('not_required');
    expect(gateStep(false, 4)).toBe('approval');
    expect(gateStep(false, 5)).toBe('blocked');
  });
});
