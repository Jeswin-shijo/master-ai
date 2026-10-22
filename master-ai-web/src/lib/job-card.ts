import type { AgentJobCardView, JobCardEdit, JobRunStatus, JobSkipReason, ResolvedPack } from '@onehuman/schemas';

/** A word set while the owner edits the card. */
export interface SetDraft {
  id: string;
  label: string;
  words: string[];
  reply: string | null;
  alert: string;
  inherited: boolean;
  fromPack: boolean;
  /** Words that stay: on a set that came with the pack, every word it had when editing began. */
  kept: string[];
}

/** The card while the owner edits it. */
export interface CardDraft {
  mission: string;
  never: string[];
  sets: SetDraft[];
}

const fold = (w: string) => w.normalize('NFC').trim().toLowerCase();

export function draftOf(card: AgentJobCardView): CardDraft {
  return {
    mission: card.mission,
    never: [...card.never],
    sets: card.escalations.map((s) => ({ ...s, words: [...s.words], kept: s.fromPack ? [...s.words] : [] })),
  };
}

/** The set with one more word; unchanged when the word is empty or already there. */
export function withWord(set: SetDraft, word: string): SetDraft {
  const w = word.trim();
  if (!w || set.words.some((x) => fold(x) === fold(w))) return set;
  return { ...set, words: [...set.words, w] };
}

/** The set without a word the owner added; the words a pack set came with stay. */
export function withoutWord(set: SetDraft, word: string): SetDraft {
  return set.kept.includes(word) ? set : { ...set, words: set.words.filter((w) => w !== word) };
}

/** A new word set of the owner's, with an id made from its name and not yet taken. */
export function newSet(label: string, taken: string[]): SetDraft {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'words';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return { id, label: label.trim(), words: [], reply: null, alert: 'owner', inherited: false, fromPack: false, kept: [] };
}

/** What the API takes: every set the card should have, with its words, alert and reply. */
export function cardEdit(draft: CardDraft): JobCardEdit {
  return {
    mission: draft.mission.trim(),
    never: draft.never.map((n) => n.trim()).filter(Boolean),
    escalate: draft.sets.map(({ id, label, words, alert, reply }) => ({ id, label: label.trim(), words, alert, ...(reply ? { reply } : {}) })),
  };
}

/** Why the draft can't be saved yet, in a sentence; null when it can. */
export function draftProblem(draft: CardDraft): string | null {
  const mission = draft.mission.trim();
  if (!mission) return 'Write the mission: one sentence on what this assistant does.';
  if (mission.length > 300) return 'Keep the mission under 300 characters.';
  const unfinished = draft.sets.find((s) => !s.label.trim() || s.words.length === 0);
  if (unfinished) return `Give ${unfinished.label.trim() ? `“${unfinished.label.trim()}”` : 'the new word set'} a name and at least one word.`;
  return null;
}

/** Who a set alerts, in plain words: "the owner", "the safety officer". */
export function alertWords(alert: string, pack?: ResolvedPack): string {
  if (alert === 'owner') return 'the owner';
  const name = pack?.lifecycle?.roles.find((r) => r.id === alert)?.name ?? alert.replace(/[-_]+/g, ' ');
  // "Safety officer" reads "the safety officer"; "CFO" stays "the CFO".
  return `the ${/^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name}`;
}

export const RUN_STATUS_WORDS: Record<JobRunStatus, string> = {
  done: 'Done',
  stopped: 'Stopped',
  needs_person: 'Needs a person',
  running: 'Running',
  failed: 'Failed',
};

/** Why Run now started nothing. */
export const SKIP_WORDS: Record<JobSkipReason, string> = {
  off: 'Not started: the job is switched off.',
  paused: 'Not started: the assistant or the company is paused.',
  cap: 'Not started: it reached its daily limit. It can run again tomorrow.',
  duplicate: 'It is already running for this.',
};
