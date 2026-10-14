import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('the first download', () => {
  it('loads each page when it is first opened, not all of them up front', () => {
    expect(main).not.toMatch(/^import .* from '@\/routes\//m);
  });

  it('routes every page file', () => {
    const pages = readdirSync(new URL('./routes', import.meta.url)).filter((f) => f.endsWith('.tsx'));
    for (const f of pages) expect(main).toContain(`import('@/routes/${f.replace(/\.tsx$/, '')}')`);
  });

  it("doesn't wait on a font stylesheet from another site before showing anything", () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
  });
});

describe('the schemas package in the browser', () => {
  const read = (u: URL) => readFileSync(u, 'utf8');
  const sources = (dir: URL): URL[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [new URL(e.name, dir)] : [],
    );

  it('takes values only from @onehuman/schemas/plain, so zod and the schemas stay out of the download', () => {
    const offenders = [...sources(new URL('./', import.meta.url)), ...sources(new URL('../../packages/sdk/src/', import.meta.url))].filter((f) =>
      /(?:import|export) (?!type )\{[^}]*\} from '@onehuman\/schemas'/.test(read(f)),
    );
    expect(offenders.map((f) => f.pathname.replace(/.*\/(master-ai-web|packages)\//, '$1/'))).toEqual([]);
  });

  it("keeps the schemas package's plain entry free of zod", () => {
    const seen = new Set<string>();
    const visit = (file: URL) => {
      if (seen.has(file.href)) return;
      seen.add(file.href);
      const text = read(file);
      expect(text, file.pathname).not.toMatch(/from 'zod'/);
      for (const [, rel] of text.matchAll(/from '(\.[^']+)'/g)) visit(new URL(`${rel}.ts`, file));
    };
    visit(new URL('../../packages/schemas/src/plain.ts', import.meta.url));
  });
});
