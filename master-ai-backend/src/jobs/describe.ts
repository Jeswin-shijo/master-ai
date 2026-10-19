import { lifecycleOf, registersOf } from '@onehuman/agent-kit';
import type { JobDef, JobTriggerKind, ResolvedPack } from '@onehuman/schemas';

/**
 * Jobs in plain words, for people: what starts a job ("Every Mon–Sat at 09:00")
 * and what started one run of it. Never a tool name, an id or JSON.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "day", "Mon–Sat", "Mon, Wed, Fri" (0 = Sunday). Three or more days in a row read as a range. */
export function daysText(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return 'day';
  const parts: string[] = [];
  for (let i = 0; i < d.length; ) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${DAY_NAMES[d[i]!]}–${DAY_NAMES[d[j]!]}`);
    else for (let k = i; k <= j; k++) parts.push(DAY_NAMES[d[k]!]!);
    i = j + 1;
  }
  return parts.join(', ');
}

const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;

const orList = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

const listLabel = (pack: ResolvedPack, id: string) => registersOf(pack).find((r) => r.id === id)?.label ?? id;

const entityLabel = (pack: ResolvedPack, name: string) => pack.entities.find((e) => e.name === name)?.label ?? name;

/** The kind of trigger a job has. */
export function triggerKind(job: JobDef): JobTriggerKind {
  const t = job.trigger;
  return t.request ? 'request' : t.schedule ? 'schedule' : t.list ? 'list' : t.record ? 'record' : 'manual';
}

/** What starts the job, as the Agents page says it. */
export function triggerText(pack: ResolvedPack, job: JobDef): string {
  const t = job.trigger;
  if (t.request) {
    if (t.request.categories.includes('any')) return 'When any request comes in';
    const categories = lifecycleOf(pack).categories;
    const names = t.request.categories.map((id) => categories.find((c) => c.id === id)?.name ?? id);
    return `When a request about ${orList(names)} comes in`;
  }
  if (t.schedule) return `Every ${daysText(t.schedule.days)} at ${t.schedule.time}`;
  if (t.list) return `When an item in ${listLabel(pack, t.list.list)} is due`;
  if (t.record) {
    const what = withArticle(entityLabel(pack, t.record.entity));
    return t.record.on === 'created' ? `When ${what} is added` : t.record.on === 'updated' ? `When ${what} is updated` : `When ${what} is added or updated`;
  }
  return 'When someone runs it';
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What started one run: `short` follows the job name in the goal's text
 * ("Morning check: scheduled run for 2026-10-19"), `full` is the task's description.
 */
export function runText(pack: ResolvedPack, job: JobDef, trigger: JobTriggerKind, payload: Record<string, unknown>): { short: string; full: string } {
  switch (trigger) {
    case 'manual': {
      const said = text(payload.text);
      return { short: 'run now', full: said ? `Someone ran it by hand and wrote: "${cut(said, 500)}"` : 'Someone ran it by hand.' };
    }
    case 'schedule': {
      const date = text(payload.date);
      const time = job.trigger.schedule?.time;
      return {
        short: date ? `scheduled run for ${date}` : 'scheduled run',
        full: `The scheduled run${date ? ` for ${date}` : ''}${time ? ` at ${time}` : ''}.`,
      };
    }
    case 'request': {
      const code = text(payload.code);
      const title = text(payload.title);
      return {
        short: code ? `request ${code}` : 'a new request',
        full: `A request came in${code ? ` (${code})` : ''}${title ? `: ${cut(title, 200)}` : ''}.`,
      };
    }
    case 'list': {
      const label = job.trigger.list ? listLabel(pack, job.trigger.list.list) : 'a list';
      return { short: `an item in ${label} is due`, full: `An item in ${label} is due.` };
    }
    case 'record': {
      const label = job.trigger.record ? entityLabel(pack, job.trigger.record.entity) : 'record';
      return { short: `${withArticle(label)} changed`, full: `${withArticle(label).replace(/^a/, 'A')} was added or changed.` };
    }
  }
}
