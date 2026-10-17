import { titleOf } from '@onehuman/agent-kit';
import type { EntityDef } from '@onehuman/schemas';
import type { FollowUpResult } from '../voice/follow-up-engine';
import { lowerFirst } from '../voice/spoken';

export interface PartyAlert {
  title: string;
  body: string;
  data: { listId: string; itemId: string };
}

const QUOTE_MAX = 120;
const TITLE_MAX = 60;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The push for what an outside party said that the head must decide on: it is
 * paid or settled, a dispute, or a wrong number. Null for anything else, which
 * shows only on the Lists badge. Words only: the item's title and the
 * contact's name, never an id.
 */
export function partyAlert(
  result: FollowUpResult,
  about: { listId: string; itemId: string; entity: EntityDef; data: Record<string, unknown>; contactName: string | null },
): PartyAlert | null {
  const named = about.contactName?.trim();
  const party = named || 'Your contact';
  const item = itemWords(about.entity, about.data);
  const data = { listId: about.listId, itemId: about.itemId };
  const quote = `"${clip(result.said)}"`;
  switch (result.kind) {
    case 'settled': {
      const word = settledWord(about.entity, result.proposed);
      const canApply = Object.keys(result.proposed).length > 0;
      return { title: `${party} says ${item} is ${word ?? 'settled'}`, body: canApply ? `${quote} Tap to apply or dismiss.` : quote, data };
    }
    case 'dispute':
      return { title: `${party} disputes ${item}`, body: quote, data };
    case 'wrong_number':
      return { title: `Wrong number for ${named || 'your contact'}`, body: `The number called about ${item} isn't theirs. Correct it on the web, then the owner can tap Call again on the note.`, data };
    default:
      return null;
  }
}

/** The proposed value of the status-like enum field, else the first enum field, as words: "part paid". Null when none is proposed. */
function settledWord(entity: EntityDef, proposed: Record<string, unknown>): string | null {
  const enums: string[] = [];
  for (const [key, value] of Object.entries(proposed)) {
    const field = entity.fields.find((f) => f.name === key);
    if (field?.type === 'enum' && typeof value === 'string' && value.trim()) enums.push(value);
  }
  const status = Object.keys(proposed).find((key) => /status/i.test(key) && enums.includes(proposed[key] as string));
  const pick = status ? (proposed[status] as string) : enums[0];
  return pick ? pick.trim().toLowerCase().replace(/-/g, ' ') : null;
}

/** "bill S-1042", or "the bill" when it has no title. */
function itemWords(entity: EntityDef, data: Record<string, unknown>): string {
  const label = lowerFirst(entity.label);
  const title = titleOf(entity, data);
  return title === entity.label ? `the ${label}` : `${label} ${clip(title, TITLE_MAX)}`;
}

/** Clips to `max` characters as people see them, so an emoji or a conjunct is never split. */
function clip(text: string, max = QUOTE_MAX): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const parts = Array.from(graphemes.segment(t), (x) => x.segment);
  return parts.length <= max ? t : `${parts.slice(0, max - 1).join('').trimEnd()}…`;
}
