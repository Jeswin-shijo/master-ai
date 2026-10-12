import type { GoalReport } from '@onehuman/schemas';

/** A goal's state in one or two words for owners and clients. */
export function goalStatusWord(status: GoalReport['status']): string {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'partially_completed':
      return 'Partly done';
    case 'failed':
      return "Couldn't be done";
    case 'cancelled':
      return 'Cancelled';
    case 'awaiting_plan_approval':
      return 'Waiting for you to approve the plan';
    case 'planning':
      return 'Being planned';
    default:
      return 'In progress';
  }
}

/** A goal's report as plain text, for WhatsApp, email or a printout. */
export function reportText(r: GoalReport): string {
  const section = (title: string, lines: string[], mark: string) => (lines.length ? [title, ...lines.map((l) => `${mark} ${l}`), ''] : []);
  const when = r.completedAt ? ` · ${new Date(r.completedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` : '';
  return [
    r.text,
    `${goalStatusWord(r.status)}${when}`,
    '',
    ...section('What was done', r.done, '✓'),
    ...section('Still in progress', r.pending, '…'),
    ...section('Needs attention', r.attention, '!'),
    ...section('People involved', r.people, '-'),
  ]
    .join('\n')
    .trim();
}
