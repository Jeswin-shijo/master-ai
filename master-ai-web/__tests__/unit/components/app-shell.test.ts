import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(new URL('../../../src/components/app-shell.tsx', import.meta.url), 'utf8');

describe('moving between pages', () => {
  // With AnimatePresence mode="wait", the next page mounts only once the last one's exit
  // animation reports done. Switching a check-in on refreshes the list while it fades out, and
  // on a slow machine that report never came: the content area stayed blank (CI, 14 Oct 2026).
  it('shows the next page at once, never waiting for the last one to finish leaving', () => {
    expect(shell).not.toMatch(/<AnimatePresence[^>]*mode="wait"/);
    expect(shell).toMatch(/<motion\.div\s+key=\{location\.pathname\}/);
  });
});
