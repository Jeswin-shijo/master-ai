import { describe, expect, it } from 'vitest';
import { ACTION_LABEL_STOPS, fontSize, gradients } from '../src/index';

describe('native tokens', () => {
  it('keeps every font size at 13 or more', () => {
    for (const size of Object.values(fontSize)) expect(size).toBeGreaterThanOrEqual(13);
  });

  it('puts the white label of the action gradient on the stops held at AA', () => {
    expect(gradients.action.colors.slice(1, 3)).toEqual([...ACTION_LABEL_STOPS]);
    expect(gradients.action.locations).toEqual([0, 0.16, 0.84, 1]);
  });
});
