import { describe, expect, it } from 'vitest';
import { ACTION_LABEL_STOPS, contrastRatio, darkPalette, lightPalette, type ColorToken } from '../src/index';

const AA = 4.5;
const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ['text', 'background'],
  ['textBody', 'background'],
  ['textLead', 'background'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textBody', 'surface'],
  ['primary', 'background'],
  ['accent', 'background'],
  ['success', 'background'],
  ['success', 'successSoft'],
  ['warning', 'background'],
  ['warning', 'warningSoft'],
  ['danger', 'background'],
  ['danger', 'dangerSoft'],
  ['info', 'background'],
];

describe.each([
  ['dark', darkPalette],
  ['light', lightPalette],
] as const)('%s palette', (_name, p) => {
  it.each(TEXT_PAIRS)('%s on %s meets AA', (fg, bg) => {
    expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the action gradient', () => {
  it('keeps white labels at AA where the label sits', () => {
    for (const stop of ACTION_LABEL_STOPS) expect(contrastRatio(darkPalette.onAction, stop)).toBeGreaterThanOrEqual(AA);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0e0918', '#0e0918')).toBeCloseTo(1, 5);
  });
});
