import type { EntityDef, ResolvedPack, StepNarrative } from '@onehuman/schemas';
import { resolveTool } from './tools';

/**
 * Agent steps in words a business owner (or their client) understands:
 * "Marked Priya Sharma's enquiry as contacted", never tool names, ids or JSON.
 * Used for goal pages, reports, approval evidence and offline task summaries.
 */
export interface NarrateInput {
  tool: string;
  status: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  /** The owner's note when they rejected the step. */
  notes?: string | null;
  pack: ResolvedPack;
  /** Data of the record the step reads or changes, when known. */
  record?: Record<string, unknown> | null;
}

interface Phrase {
  /** Imperative, lower case: "mark Priya's enquiry as contacted". */
  present: string;
  /** Finished, sentence case: "Marked Priya's enquiry as contacted". */
  past: string;
  short: string;
  items?: string[];
  /** A read-only step: shown as information, not as work done. */
  read?: boolean;
}

export function narrateStep(input: NarrateInput): StepNarrative {
  const p = phrase(input);
  switch (input.status) {
    case 'executed':
      return { text: p.past, short: p.short, ...(p.items?.length && { items: p.items }), tone: p.read ? 'info' : 'done' };
    case 'awaiting_approval':
      return { text: `Waiting for your approval to ${p.present}.`, short: p.short, tone: 'pending' };
    case 'running':
      return { text: input.tool === 'staff.delegate' ? `${cap(p.present)}: calls in progress.` : `Working on it: ${p.present}.`, short: p.short, tone: 'pending' };
    case 'proposed':
      return { text: `About to ${p.present}.`, short: p.short, tone: 'pending' };
    case 'rejected':
      return { text: `You said no to: ${p.present}${input.notes ? ` ("${input.notes}")` : ''}.`, short: p.short, tone: 'problem' };
    case 'blocked':
      return { text: `Not allowed by your rules, so it was not done: ${p.present}.`, short: p.short, tone: 'problem' };
    case 'failed':
      return { text: `Couldn't ${p.present}: ${humanError(input.error)}.`, short: p.short, tone: 'problem' };
    default:
      return { text: cap(p.present), short: p.short, tone: 'info' };
  }
}

function phrase(input: NarrateInput): Phrase {
  const tool = resolveTool(input.pack, input.tool);
  const primitive = tool?.primitive.name ?? input.tool;
  const args = { ...input.args, ...(tool?.fixedArgs ?? {}) };
  const result = (input.result ?? null) as Record<string, unknown> | null;
  const entity = input.pack.entities.find((e) => e.name === args.entity || e.name === result?.entity);
  const label = (entity?.label ?? String(args.entity ?? 'record')).toLowerCase();
  const plural = (entity?.plural_label ?? `${label}s`).toLowerCase();
  const data = (input.record ?? (result?.data as Record<string, unknown> | undefined) ?? (args.data as Record<string, unknown> | undefined)) || null;
  const thing = data ? recordPhrase(entity, data, label) : `the ${label}`;
  const to = str(args.to ?? args.recipient ?? args.payer);
  const channel = channelName(args.channel);
  const money = typeof args.amount === 'number' ? inr(args.amount) : null;
  const testMode = result?.status === 'simulated' ? ' (test mode: recorded, not actually sent yet)' : '';

  switch (primitive) {
    case 'records.search': {
      const found = Array.isArray(result?.records) ? (result.records as Record<string, unknown>[]) : [];
      const count = typeof result?.count === 'number' ? result.count : found.length;
      const about = args.query ? ` for "${String(args.query)}"` : '';
      const outcome = result ? (count === 0 ? ` and found none` : ` and found ${count}`) : '';
      return {
        present: `look up ${plural}${about}`,
        past: `Looked up ${plural}${about}${outcome}.`,
        short: `Find ${plural}`,
        items: found.slice(0, 5).map((r) => recordLine(entity, r)),
        read: true,
      };
    }
    case 'records.get':
      return { present: `open ${thing}`, past: `Opened ${thing}.`, short: `Open ${label}`, read: true };
    case 'knowledge.search': {
      const results = Array.isArray(result?.results) ? result.results.length : null;
      return {
        present: `check the company notes for "${str(args.query)}"`,
        past: `Checked the company notes for "${str(args.query)}"${results === null ? '' : results ? ` and found ${results} useful note${results === 1 ? '' : 's'}` : ' and found nothing relevant'}.`,
        short: 'Check notes',
        read: true,
      };
    }
    case 'records.create': {
      const name = data ? recordPhrase(entity, data, label, 'for') : '';
      return { present: `add a new ${label}${name ? ` ${name}` : ''}`, past: `Added a new ${label}${name ? ` ${name}` : ''}.`, short: `Add ${label}` };
    }
    case 'records.update': {
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      const verb = tool?.alias ? aliasVerb(tool.alias.name) : null;
      if (typeof patch.status === 'string') {
        const status = patch.status.replace(/_/g, ' ');
        return { present: `mark ${thing} as ${status}`, past: `Marked ${thing} as ${status}.`, short: verb ?? `Mark ${status}` };
      }
      const fields = Object.keys(patch).map(humanKey);
      const what = fields.length ? ` (${fields.join(', ')})` : '';
      return { present: `update ${thing}${what}`, past: `Updated ${thing}${what}.`, short: verb ?? `Update ${label}` };
    }
    case 'message.draft':
      return {
        present: `draft ${channel} to ${to || 'the customer'}`,
        past: `Drafted ${channel} to ${to || 'the customer'} for you to review.`,
        short: 'Draft message',
        items: args.body ? [`"${str(args.body)}"`] : undefined,
      };
    case 'message.send':
      return {
        present: `send ${channel} to ${to || 'the customer'}`,
        past: `Sent ${channel} to ${to || 'the customer'}${testMode}.`,
        short: 'Send message',
        items: args.body ? [`"${str(args.body)}"`] : undefined,
      };
    case 'payment.request':
      return {
        present: `ask ${to || 'the customer'} to pay ${money ?? 'the amount due'}${args.purpose ? ` for ${str(args.purpose)}` : ''}`,
        past: `Asked ${to || 'the customer'} to pay ${money ?? 'the amount due'}${args.purpose ? ` for ${str(args.purpose)}` : ''}${testMode}.`,
        short: 'Request payment',
      };
    case 'refund.issue':
      return {
        present: `refund ${money ?? 'the amount'} to ${to || 'the customer'}${args.reason ? ` (${str(args.reason)})` : ''}`,
        past: `Refunded ${money ?? 'the amount'} to ${to || 'the customer'}${args.reason ? ` (${str(args.reason)})` : ''}${testMode}.`,
        short: 'Refund',
      };
    case 'schedule.create': {
      const when = typeof args.start === 'string' ? ` for ${when_(args.start)}` : '';
      return { present: `put "${str(args.title)}" in the calendar${when}`, past: `Put "${str(args.title)}" in the calendar${when}${testMode}.`, short: 'Schedule' };
    }
    case 'document.generate': {
      const kind = str(args.kind || 'document');
      return { present: `prepare a ${kind}: "${str(args.title)}"`, past: `Prepared a draft ${kind}: "${str(args.title)}".`, short: `Prepare ${kind}` };
    }
    case 'staff.delegate': {
      const r = result as { summary?: string; staff?: { name?: string } } | null;
      const who = r?.staff?.name ?? str(args.assignee);
      const task = str(args.task).replace(/[.!?]$/, '');
      return {
        present: `get ${who} to handle it by phone: ${task}`,
        past: r?.summary ? `Phoned ${who} to get this done: ${task}. ${r.summary.replace(/\.?$/, '.')}` : `Phoned ${who} to get this done: ${task}.`,
        short: `Call ${who.split(' ')[0]}`,
      };
    }
    case 'human.handoff':
      return { present: `hand this over to you: ${str(args.reason)}`, past: `Handed this over to you: ${str(args.reason)}.`, short: 'Hand to you' };
    default: {
      const description = (tool?.description ?? input.tool).replace(/\.$/, '');
      return { present: lowerFirst(description), past: `${cap(description)}.`, short: aliasVerb(input.tool) };
    }
  }
}

/** "Priya Sharma's enquiry", "the booking for Rahul Nair", or 'enquiry "Site visit"'. */
export function recordPhrase(entity: EntityDef | undefined, data: Record<string, unknown>, label: string, style: 'possessive' | 'for' = 'possessive'): string {
  const person = personOf(data);
  const title = entity?.title_field ? str(data[entity.title_field]) : '';
  if (person) {
    const extra = title && title !== person ? ` ("${title}")` : '';
    return style === 'for' ? `for ${person}${extra}` : `${person}'s ${label}${extra}`;
  }
  if (title) return style === 'for' ? `"${title}"` : `the ${label} "${title}"`;
  return style === 'for' ? '' : `the ${label}`;
}

/** One record as a short line: "Priya Sharma — Enquiry subject 2 · contacted · ₹12,000". */
export function recordLine(entity: EntityDef | undefined, data: Record<string, unknown>): string {
  const person = personOf(data);
  const title = entity?.title_field ? str(data[entity.title_field]) : '';
  const head = [person, title && title !== person ? title : ''].filter(Boolean).join(' — ') || 'Untitled';
  const facts: string[] = [];
  for (const f of entity?.fields ?? []) {
    const v = data[f.name];
    if (v === undefined || v === null || v === '' || f.name === entity?.title_field || str(v) === person) continue;
    if (f.type === 'enum') facts.push(String(v).replace(/_/g, ' '));
    else if (f.type === 'money' && typeof v === 'number') facts.push(inr(v));
    else if ((f.type === 'date' || f.type === 'datetime') && typeof v === 'string') facts.push(`${f.label.toLowerCase()} ${when_(v, f.type === 'date')}`);
    if (facts.length >= 3) break;
  }
  return facts.length ? `${head} · ${facts.join(' · ')}` : head;
}

/** "Enquiry 669d140b-… not found" → "that enquiry wasn't found". */
export function humanError(error: string | null | undefined): string {
  if (!error) return 'something went wrong';
  const clean = error
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const missing = /^(\w+) not found$/i.exec(clean);
  if (missing) return `that ${missing[1]!.toLowerCase()} wasn't found`;
  return lowerFirst(clean.split('\n')[0]!.replace(/\.$/, ''));
}

function personOf(data: Record<string, unknown>): string {
  const key = Object.keys(data).find((k) => /name$/i.test(k) && typeof data[k] === 'string' && data[k]);
  return key ? String(data[key]) : '';
}

/** enquiry.mark_contacted → "Mark contacted"; booking.confirm → "Confirm booking". */
function aliasVerb(name: string): string {
  const [object, verb] = name.includes('.') ? (name.split('.') as [string, string]) : ['', name];
  const words = verb.split('_');
  return cap(words.length > 1 ? words.join(' ') : `${words[0]} ${object}`.trim());
}

function channelName(channel: unknown): string {
  switch (channel) {
    case 'whatsapp':
      return 'a WhatsApp message';
    case 'email':
      return 'an email';
    case 'sms':
      return 'an SMS';
    default:
      return 'a message';
  }
}

function humanKey(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

function when_(iso: string, dateOnly = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
  }).format(d);
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
