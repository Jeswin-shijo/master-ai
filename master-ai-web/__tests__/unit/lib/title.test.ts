import { describe, expect, it } from 'vitest';
import { navTitle, pageTitle } from '../../../src/lib/title';

describe('page titles', () => {
  it("names the tab after the page, then the product, so tabs, history and a printed PDF's file name say what it is", () => {
    expect(pageTitle('JOB-0001 · Lineman shock · Job report')).toBe('JOB-0001 · Lineman shock · Job report · ONEHUMAN OS');
    expect(pageTitle(undefined)).toBe('ONEHUMAN OS');
  });

  it('names menu pages by their menu label, and leaves other pages to name themselves', () => {
    expect(navTitle('/')).toBe('Home');
    expect(navTitle('/reports')).toBe('Reports');
    expect(navTitle('/settings')).toBe('Settings');
    expect(navTitle('/cases/8f1d2c3b-0000-4000-8000-000000000001')).toBeUndefined();
  });
});
