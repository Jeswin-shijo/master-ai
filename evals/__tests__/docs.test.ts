import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORG_TYPES } from '@onehuman/schemas';

/** The docs people read first must match the repository: links resolve, every decision and command is listed. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const ADRS = readdirSync(join(ROOT, 'docs/adr')).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
const SKIP = new Set(['node_modules', 'dist', '.git', '.turbo', '.expo', '.superpowers', 'superpowers', 'test-results', 'playwright-report']);

/** Every README.md in the repository, outside dependencies, build output and the plan archive. */
function readmes(dir = ''): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : readmes(join(dir, e.name));
    return e.name === 'README.md' ? [join(dir, e.name)] : [];
  });
}

const DOCS = [
  ...new Set([
    'CLAUDE.md',
    'CONTRIBUTING.md',
    ...readmes(),
    ...readdirSync(join(ROOT, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`),
    ...ADRS.map((f) => `docs/adr/${f}`),
  ]),
].sort();

/** Relative markdown links, without their #anchor; web links and same-page anchors are skipped. */
function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((href) => !/^(https?:|mailto:|#)/.test(href))
    .map((href) => decodeURIComponent(href.split('#')[0]!));
}

describe('the docs', () => {
  it.each(DOCS)('%s links only to files that exist', (doc) => {
    expect(relativeLinks(read(doc)).filter((href) => !existsSync(resolve(ROOT, dirname(doc), href)))).toEqual([]);
  });

  it('decision records are numbered 0001 upwards with no gaps, and README links each one', () => {
    expect(ADRS.map((f) => f.slice(0, 4))).toEqual(ADRS.map((_, i) => String(i + 1).padStart(4, '0')));
    const readme = read('README.md');
    expect(ADRS.filter((f) => !readme.includes(`docs/adr/${f}`))).toEqual([]);
  });

  it('README or CLAUDE.md explains every root command', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts as Record<string, string>);
    // These four are what `pnpm turbo run build typecheck test` (and lint) runs; the docs name that instead.
    const viaTurbo = new Set(['build', 'typecheck', 'test', 'lint']);
    const text = read('README.md') + read('CLAUDE.md');
    const named = (s: string) => new RegExp(`pnpm ${s.replace(/[:]/g, '\\:')}(?![\\w:-])`).test(text);
    expect(scripts.filter((s) => !viaTurbo.has(s) && !named(s))).toEqual([]);
  });

  it('README names every ready-made organization type', () => {
    const readme = read('README.md');
    expect(ORG_TYPES.filter((t) => !readme.includes(t.name)).map((t) => t.name)).toEqual([]);
  });
});
