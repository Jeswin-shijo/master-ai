import type { HumanRole, ListHistoryEntry, ListItem, ListMeta, ListNote, ListPage, ListSummary, ListsOverview } from '@onehuman/schemas';
import { amountText, itemCell, lowerWords } from '@onehuman/sdk';

/*
 * The phone's lists in words: what the tab, a list and an item say. Pure, so
 * the unit tests run it in Node; the screens and hooks import it. The wording
 * the web shares comes from @onehuman/sdk.
 */

/** Shown beside the actions while there is no signal. */
export const NEEDS_CONNECTION = 'Needs a connection';

/** The Lists tab is for the owner and admins; the server refuses members anyway. */
export function canSeeLists(role: HumanRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The tab's badge: notes from calls nobody has looked at yet, over every list. */
export function newNotesTotal(overview: ListsOverview | undefined): number {
  return (overview?.lists ?? []).reduce((n, l) => n + l.card.newNotes, 0);
}

/** A card's count and sum: "12 this month · ₹4,82,600 to collect". */
export function cardCount(list: ListSummary): string {
  const { count, countLabel, sum, sumField, sumLabel } = list.card;
  const parts = [`${count} ${countLabel}`];
  if (sum !== null) {
    const field = sumField ? list.entity.fields.find((f) => f.name === sumField) : undefined;
    parts.push(sumLabel ? `${amountText(field, sum)} ${sumLabel}` : amountText(field, sum));
  }
  return parts.join(' · ');
}

/** What needs looking at, leaving out what is zero: "3 with problems · 5 not checked · 2 new from calls". Null when nothing does. */
export function cardMarks(list: ListSummary): string | null {
  const { problems, notChecked, newNotes } = list.card;
  const parts: string[] = [];
  if (problems) parts.push(`${problems} with problems`);
  if (notChecked) parts.push(`${notChecked} not checked`);
  if (newNotes) parts.push(`${newNotes} new from calls`);
  return parts.length ? parts.join(' · ') : null;
}

/** What matches, under a list's heading: "48 bills · Total ₹12,40,000". */
export function pageTotals(page: ListPage): string {
  const { list, total, totals } = page;
  const parts = [`${total} ${total === 1 ? lowerWords(list.entity.label) : lowerWords(list.label)}`];
  for (const name of list.totals) {
    const field = list.entity.fields.find((f) => f.name === name);
    if (field) parts.push(`${field.label} ${amountText(field, totals[name] ?? 0)}`);
  }
  return parts.join(' · ');
}

/** The line under a row's title: the list's first two columns after the title, in words, leaving out empty ones. */
export function rowSummary(list: ListMeta, item: ListItem): string {
  const title = list.entity.title_field ?? list.entity.fields.find((f) => f.type === 'string')?.name;
  return list.columns
    .filter((name) => name !== title)
    .slice(0, 2)
    .flatMap((name) => list.entity.fields.filter((f) => f.name === name))
    .map((f) => itemCell(f, item))
    .filter((text) => text !== '—')
    .join(' · ');
}

/** Items a date range leaves out because they have no date. Null when there are none. */
export function undatedLine(page: ListPage): string | null {
  const n = page.undated;
  const field = page.list.dateField ? page.list.entity.fields.find((f) => f.name === page.list.dateField) : undefined;
  if (!n || !field) return null;
  return n === 1 ? `1 item has no ${lowerWords(field.label)} and isn't shown.` : `${n} items have no ${lowerWords(field.label)} and aren't shown.`;
}

/** After "Mark N checked". The server leaves items with open problems: those need a note, one at a time. */
export function checkedLine(r: { checked: number; skipped: number }): string {
  const done = `${r.checked} marked checked.`;
  if (!r.skipped) return done;
  return r.skipped === 1 ? `${done} 1 has problems: open it to check it with a note.` : `${done} ${r.skipped} have problems: open each to check it with a note.`;
}

/** The item's check button: "anyway", with a note, while a problem is open; none when it is checked with nothing open. */
export function checkButton(item: ListItem): { label: 'Mark checked' | 'Mark checked anyway'; needsNote: boolean } | null {
  if (item.problems.some((p) => !p.acknowledged)) return { label: 'Mark checked anyway', needsNote: true };
  return item.checked ? null : { label: 'Mark checked', needsNote: false };
}

export type NoteAction = 'apply' | 'dismiss' | 'seen' | 'call-again';
export const NOTE_ACTION_LABELS: Record<NoteAction, string> = { apply: 'Apply', dismiss: 'Dismiss', seen: 'Seen', 'call-again': 'Call again' };

/** A note's buttons, as on the web: Apply and Dismiss when it proposes changes, Seen when it doesn't, Call again where the server says it works. */
export function noteActions(note: ListNote): NoteAction[] {
  const out: NoteAction[] = [];
  if (note.status === 'new') out.push(...(note.proposed.length ? (['apply', 'dismiss'] as const) : (['seen'] as const)));
  if (note.canCallAgain) out.push('call-again');
  return out;
}

/** "New from a call", "Applied by Asha Owner" or "Seen by Asha Owner". */
export function noteState(note: ListNote): string {
  if (note.status === 'new') return 'New from a call';
  return `${note.status === 'applied' ? 'Applied' : 'Seen'} by ${note.decidedBy ?? 'someone'}`;
}

/** "Asha Owner checked it". */
export function historyWords(e: ListHistoryEntry): string {
  return `${e.who} ${e.kind === 'created' ? 'added it' : e.kind === 'checked' ? 'checked it' : 'changed it'}`;
}

/** While there is no signal: what the screen holds and when it was loaded. Null while online. `timeZone` is for tests. */
export function noSignalLine(offline: boolean, loadedAt: number, timeZone?: string): string | null {
  if (!offline) return null;
  if (!loadedAt) return 'No signal. Pull down to try again once you are back online.';
  return `No signal. Showing what was loaded at ${new Date(loadedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone })}.`;
}
