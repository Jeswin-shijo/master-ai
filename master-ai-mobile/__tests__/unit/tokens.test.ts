/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

function offenders(pattern: RegExp, keep: (m: RegExpMatchArray) => boolean = () => true): string[] {
  return sources(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(pattern)].filter(keep).map((m) => `${relative(SRC, file)}: ${m[0]}`),
  );
}

describe('the phone app takes its look from the Glow tokens', () => {
  it('uses no hex or named colours', () => {
    expect([...offenders(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g), ...offenders(/['"](?:white|black)['"]/g)]).toEqual([]);
  });

  it('keeps all text at 13 or more', () => {
    expect(offenders(/fontSize:\s*(\d+(?:\.\d+)?)/g, (m) => Number(m[1]) < 13)).toEqual([]);
  });

  it('picks Red Hat weights by font family, never fontWeight (Android drops a custom font with it)', () => {
    expect(offenders(/fontWeight\s*:/g)).toEqual([]);
  });
});
