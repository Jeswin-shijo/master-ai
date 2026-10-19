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

/** Lower-cases, NFC-normalises and splits text into letter, mark and number runs. */
function tokens(text: string): string[] {
  return text.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/**
 * The listed words found in the text, in list order. A word matches a whole token, or the token
 * with one common ending (s, es, d, ed, ing, er, ers). A phrase matches consecutive tokens; only
 * its last token may carry an ending.
 */
export function matchWords(text: string, words: string[]): string[] {
  const found = tokens(text);
  const hits: string[] = [];
  for (const word of words) {
    const want = tokens(word);
    if (want.length === 0) continue;
    const last = want[want.length - 1]!;
    for (let i = 0; i + want.length <= found.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length - 1 && ok; j++) ok = found[i + j] === want[j];
      if (!ok) continue;
      const token = found[i + want.length - 1]!;
      if (SUFFIXES.some((s) => token === last + s)) {
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
