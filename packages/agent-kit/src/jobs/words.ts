/** An escalation set as a job sees it: pack and workspace sets merged, ready to match. */
export type EffectiveEscalation = {
  id: string;
  label: string;
  words: string[];
  reply: string | null;
  alert: string;
  inherited: boolean;
  fromPack: boolean;
};

const SUFFIXES = ['', 's', 'es', 'd', 'ed', 'ing', 'er', 'ers'];

/**
 * Invisible characters that can sit inside a word without showing: zero-width space, non-joiner
 * and joiner, word joiner, byte-order mark and soft hyphen. Left in, they would split a word in two.
 */
const INVISIBLE = /[­​-‍⁠﻿]/g;

const DIGITS = /^\p{Nd}+$/u;

/** Drops invisible characters, then NFC-normalises and lower-cases. */
function clean(text: string): string {
  return text.replace(INVISIBLE, '').normalize('NFC').toLowerCase();
}

/** The text split into letter, mark and number runs. */
function tokens(text: string): string[] {
  return clean(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** A listed word split the same way, keeping each run of `#` as a stand-in for that many digits. */
function parts(word: string): string[] {
  return clean(word).match(/[\p{L}\p{M}\p{N}]+|#+/gu) ?? [];
}

function fits(part: string, token: string, last: boolean): boolean {
  if (part.startsWith('#')) return DIGITS.test(token) && token.length === part.length;
  return last ? SUFFIXES.some((s) => token === part + s) : token === part;
}

/**
 * The listed words found in the text, in list order. A word matches a whole token, or the token
 * with one common ending (s, es, d, ed, ing, er, ers). A phrase matches consecutive tokens; only
 * its last token may carry an ending. A run of `#` matches a number with exactly that many digits,
 * so "pin ####" finds "pin 4821" but not "pin 560034".
 */
export function matchWords(text: string, words: string[]): string[] {
  const found = tokens(text);
  const hits: string[] = [];
  for (const word of words) {
    const want = parts(word);
    if (want.length === 0) continue;
    for (let i = 0; i + want.length <= found.length; i++) {
      if (want.every((part, j) => fits(part, found[i + j]!, j === want.length - 1))) {
        hits.push(word);
        break;
      }
    }
  }
  return hits;
}

/** The first set, in order, with any word found in the text. */
export function findEscalation(
  text: string,
  sets: EffectiveEscalation[],
): { set: EffectiveEscalation; words: string[] } | null {
  for (const set of sets) {
    const words = matchWords(text, set.words);
    if (words.length > 0) return { set, words };
  }
  return null;
}
