/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsxFiles(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

/** Reports print on white paper, so `print:` classes may use plain black and white. */
const withoutPrint = (source: string) => source.replace(/print:[^\s"'`]+/g, '');

const RAW_COLOUR =
  /(?<![\w-])(?:bg|text|border|ring|outline|shadow|fill|stroke|from|via|to|decoration|divide)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;
const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/g;
const TINY_TEXT = /text-\[(\d+(?:\.\d+)?)px\]/g;

function offenders(pattern: RegExp, keep: (m: RegExpMatchArray) => boolean = () => true): string[] {
  return tsxFiles(SRC).flatMap((file) =>
    [...withoutPrint(readFileSync(file, 'utf8')).matchAll(pattern)].filter(keep).map((m) => `${relative(SRC, file)}: ${m[0]}`),
  );
}

describe('colour and type come from the Glow tokens', () => {
  it('uses no raw Tailwind colours', () => {
    expect(offenders(RAW_COLOUR)).toEqual([]);
  });

  it('uses no hex colours in components', () => {
    expect(offenders(HEX)).toEqual([]);
  });

  it('keeps all text at 13px or more', () => {
    expect(offenders(TINY_TEXT, (m) => Number(m[1]) < 13)).toEqual([]);
  });
});
