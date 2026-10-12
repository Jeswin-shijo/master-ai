import type { PolicyRule, ResolvedPack } from '@onehuman/schemas';

/**
 * Pack terms in everyday words, for owners and their clients:
 * `knowledge.search` → "Search company notes", clearance 2 → "Drafts only",
 * a policy rule → "Refunds above ₹2,00,000 are never done by the AI".
 */

const TOOL_LABELS: Record<string, string> = {
  'records.search': 'Find records',
  'records.get': 'Open records',
  'records.create': 'Add records',
  'records.update': 'Update records',
  'knowledge.search': 'Search company notes',
  'message.draft': 'Draft messages',
  'message.send': 'Send messages',
  'payment.request': 'Ask for payments',
  'refund.issue': 'Give refunds',
  'schedule.create': 'Book meetings',
  'document.generate': 'Prepare documents',
  'staff.delegate': 'Phone your team',
  'human.handoff': 'Hand over to you',
};

/** Rule subjects: [phrase, is it plural]. */
const TOOL_NOUNS: Record<string, [string, boolean]> = {
  'records.search': ['Looking up records', false],
  'records.get': ['Opening records', false],
  'records.create': ['Adding records', false],
  'records.update': ['Changing records', false],
  'knowledge.search': ['Searching company notes', false],
  'message.draft': ['Message drafts', true],
  'message.send': ['Messages to customers', true],
  'payment.request': ['Payment requests', true],
  'refund.issue': ['Refunds', true],
  'schedule.create': ['Calendar bookings', true],
  'document.generate': ['Documents', true],
  'staff.delegate': ['Jobs handed to the team', true],
  'human.handoff': ['Hand-overs to you', true],
};

const CONNECTORS: Record<string, string> = {
  'booking-engine': 'Booking engine',
  'whatsapp-business': 'WhatsApp Business',
  whatsapp: 'WhatsApp',
  razorpay: 'Razorpay',
  gmail: 'Gmail',
  tally: 'Tally',
  'google-calendar': 'Google Calendar',
};

/** What an agent may do without asking, by clearance level. */
export function clearanceLabel(level: number): { short: string; long: string } {
  switch (level) {
    case 1:
      return { short: 'Looks only', long: 'Can look things up on its own. Anything else waits for your OK.' };
    case 2:
      return { short: 'Drafts only', long: 'Can look things up and prepare drafts on its own. Nothing leaves the company without your OK.' };
    default:
      return { short: 'Everyday tasks', long: 'Handles everyday tasks on its own, within its limits. Bigger or risky steps wait for your OK.' };
  }
}

/** A tool as a short phrase: "Search company notes", "Mark enquiries as contacted". */
export function toolLabel(name: string, pack?: ResolvedPack): string {
  const alias = pack?.tools.find((t) => t.name === name);
  if (!alias) return TOOL_LABELS[name] ?? sentence(name.replace(/[._]/g, ' '));
  const entity = pack?.entities.find((e) => e.name === alias.with?.entity);
  const [object = '', verb = name] = name.includes('.') ? name.split('.') : ['', name];
  const things = (entity?.plural_label ?? `${entity?.label ?? object}s`).toLowerCase();
  const status = (alias.with?.patch as { status?: unknown } | undefined)?.status;
  if (alias.uses === 'records.update' && typeof status === 'string') return `Mark ${things} as ${status.replace(/_/g, ' ')}`;
  const words = verb.split('_');
  return sentence(`${words[0]} ${things}${words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''}`);
}

/** A policy rule as a sentence: "Payment requests above ₹25,000 need your OK first". */
export function ruleText(rule: PolicyRule, pack?: ResolvedPack): string {
  const [subject, plural] = ruleSubject(rule.action, pack);
  const agent = rule.agent ? pack?.agents.find((a) => a.role === rule.agent)?.name ?? sentence(rule.agent.replace(/-/g, ' ')) : null;
  const who = agent ? ` by the ${agent}` : '';
  const above = (t?: { amount: number }) => (t ? ` above ₹${t.amount.toLocaleString('en-IN')}` : '');
  if (rule.action === '*' && rule.forbid) return `${agent ? `The ${agent}` : 'The AI'} may not act at all`;
  if (rule.forbid || rule.forbid_above) return `${subject}${who}${above(rule.forbid_above)} ${plural ? 'are' : 'is'} never done by the AI`;
  return `${subject}${who}${above(rule.require_approval_above)} ${plural ? 'need' : 'needs'} your OK first`;
}

/** "whatsapp-business" → "WhatsApp Business". */
export function connectorName(slug: string): string {
  return CONNECTORS[slug] ?? slug.split(/[-_]/).map(sentence).join(' ');
}

function ruleSubject(action: string, pack?: ResolvedPack): [string, boolean] {
  if (action === '*') return ['Every action', false];
  if (TOOL_NOUNS[action]) return TOOL_NOUNS[action];
  // A pack action: "Mark bookings as cancelled" → "Marking bookings as cancelled".
  const [first = '', ...rest] = toolLabel(action, pack).split(' ');
  return [[gerund(first), ...rest].join(' '), false];
}

function gerund(verb: string): string {
  const w = verb.toLowerCase();
  const ing = /[^e]e$/.test(w) ? `${w.slice(0, -1)}ing` : /[^aeiou][aeiou]l$/.test(w) ? `${w}ling` : `${w}ing`;
  return sentence(ing);
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
