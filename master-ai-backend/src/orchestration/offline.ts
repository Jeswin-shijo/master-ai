import type { EntityDef, PackAgent, PlannedTask, ResolvedPack } from '@onehuman/schemas';
import { toWireName, type ResolvedTool } from '@onehuman/agent-kit';
import type { LlmToolCall, OfflineResult } from '../llm/llm.service';
import { parseDue } from '../voice/time';

/**
 * Deterministic stand-ins for the model, used when no LLM is configured. They
 * follow the same contracts as the real calls (a plan, one tool call per step)
 * so the whole platform (policy gates, approvals, audit) runs end to end in
 * development, CI and demos. Results are labelled provider "offline".
 */

const STOP = new Set('a an the and or of to for in on with by at from this that these those is are be our my we me i it'.split(' '));

function stem(w: string): string {
  let s = w;
  if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 4) s = s.slice(0, -1);
  // cancelled → cancell → cancel
  if (/([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

// ---------- planning ----------

export function offlinePlan(goalText: string, pack: ResolvedPack): { rationale: string; tasks: PlannedTask[] } {
  const goalWords = words(goalText);
  const scored = pack.workflows
    .map((wf) => ({
      wf,
      // The workflow's name says what it is for; keywords and description are weaker signals.
      score:
        overlap(goalWords, words(wf.name)) * 3 +
        overlap(goalWords, words(wf.keywords.join(' '))) * 2 +
        overlap(goalWords, words(wf.description)),
    }))
    .filter((s) => s.wf.steps.every((step) => pack.agents.some((a) => a.role === step.agent)))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score > 0) {
    return {
      rationale: `Matched the "${best.wf.name}" workflow from the ${pack.name} pack.`,
      tasks: best.wf.steps.map((s) => ({
        key: s.key,
        title: s.title,
        description: `${s.instructions}\nOwner's goal: ${goalText}`,
        agentRole: s.agent,
        dependsOn: s.depends_on,
      })),
    };
  }

  const agent = bestAgent(goalText, pack.agents);
  return {
    rationale: `No workflow matched, so the goal goes to the ${agent.name}, whose role fits best.`,
    tasks: [{ key: 'do-goal', title: truncate(goalText, 80), description: goalText, agentRole: agent.role, dependsOn: [] }],
  };
}

function bestAgent(goalText: string, agents: PackAgent[]): PackAgent {
  const goalWords = words(goalText);
  return [...agents].sort(
    (a, b) =>
      overlap(goalWords, words(`${b.name} ${b.description} ${b.tools.join(' ')}`)) -
      overlap(goalWords, words(`${a.name} ${a.description} ${a.tools.join(' ')}`)),
  )[0]!;
}

// ---------- agent steps ----------

export interface OfflineHistoryItem {
  tool: string;
  status: string;
  args: Record<string, unknown>;
  result: unknown;
  error: string | null;
  notes?: string | null;
}

export interface OfflineStepInput {
  goalText: string;
  taskTitle: string;
  taskDescription: string;
  pack: ResolvedPack;
  tools: ResolvedTool[];
  history: OfflineHistoryItem[];
  /** People in charge the agent can delegate to. */
  team?: { name: string; title: string; responsibilities: string[] }[];
}

const READ = new Set(['records.search', 'knowledge.search']);

export function offlineAgentStep(input: OfflineStepInput): OfflineResult {
  const text = `${input.taskTitle}\n${input.taskDescription}\n${input.goalText}`;
  const textWords = words(text);
  const usable = input.tools.filter((t) => t.primitive.control !== 'handoff' && t.primitive.name !== 'records.get');
  const reads = usable.filter((t) => READ.has(t.primitive.name));
  const actions = usable.filter((t) => !READ.has(t.primitive.name));

  const attempted = (t: ResolvedTool) => input.history.some((h) => h.tool === t.name);
  const lastRecords = latestRecords(input.history);

  // Work that people do goes straight to the person in charge.
  const delegateTool = actions.find((t) => t.primitive.control === 'delegate');
  if (delegateTool && input.history.some((h) => h.tool === delegateTool.name && h.status === 'executed')) {
    return finish(input.history);
  }
  if (delegateTool && !attempted(delegateTool) && input.team?.length) {
    const titleWords = words(input.taskTitle);
    const others = actions.filter((t) => t !== delegateTool);
    const fitsOther = others.some((t) => overlap(titleWords, words(`${t.name.replace(/[._]/g, ' ')} ${t.description}`)) > 0);
    if (!fitsOther) {
      return step(`I'll hand this to the person in charge and follow it up by phone.`, delegateTool, delegateArgs(input));
    }
  }

  // 1. Look before acting.
  const read = pickRead(reads, input.pack, text);
  if (read && !attempted(read)) {
    // Filters come from the owner's words and the task title, never from the instructions.
    const ownerWords = `${input.taskTitle}\n${input.goalText}`;
    return step(`I'll start by looking up what we already have.`, read, readArgs(read, input.pack, ownerWords));
  }

  // 2. Take the one action that best fits the task (skipping ones with nothing to act on).
  // The task title says what to do; the description and goal only add context.
  const titleWords = words(input.taskTitle);
  const ranked = [...actions]
    .map((t) => {
      const toolWords = words(`${t.name.replace(/[._]/g, ' ')} ${t.description}`);
      return { t, score: overlap(titleWords, toolWords) * 3 + overlap(textWords, toolWords) + t.baseLevel * 0.1 };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score >= 1 && !actions.some(attempted)) {
    const args = actionArgs(best.t, input.pack, text, lastRecords);
    if (args) return step(`Next, ${describeIntent(best.t)}.`, best.t, args);
    // Nothing to act on (no matching record, no known amount): say so instead of doing something else.
    return finish(input.history, `Could not ${best.t.name.split('.').pop()?.replace(/_/g, ' ')}: no matching record or amount was found, so nothing was changed.`);
  }

  // 3. Wrap up.
  return finish(input.history);
}

function delegateArgs(input: OfflineStepInput): Record<string, unknown> {
  const text = `${input.taskTitle} ${input.taskDescription} ${input.goalText}`;
  const want = words(text);
  const best = [...(input.team ?? [])]
    .map((p) => ({ p, score: overlap(want, words(`${p.title} ${p.responsibilities.join(' ')}`)) }))
    .sort((a, b) => b.score - a.score)[0]?.p;
  const due = parseDue(input.goalText);
  return {
    assignee: best?.name ?? input.team?.[0]?.name ?? 'operations manager',
    task: input.goalText,
    ...(due && { due: due.toISOString() }),
  };
}

function step(text: string, tool: ResolvedTool, args: Record<string, unknown>): OfflineResult {
  const call: LlmToolCall = { name: toWireName(tool.name), input: args };
  return { text, toolCalls: [call] };
}

function finish(history: OfflineHistoryItem[], note?: string): OfflineResult {
  const lines = history.map((h) => {
    const outcome =
      h.status === 'executed'
        ? 'done'
        : h.status === 'rejected'
          ? `rejected by the owner${h.notes ? ` ("${h.notes}")` : ''}`
          : h.status === 'blocked'
            ? 'blocked by policy'
            : h.status === 'failed'
              ? `failed (${h.error ?? 'error'})`
              : h.status;
    const result = h.result as { count?: number; summary?: string } | null;
    if (h.tool === 'staff.delegate' && result?.summary) return result.summary.replace(/\.$/, '');
    return `${h.tool}${typeof result?.count === 'number' ? ` (${result.count} found)` : ''}: ${outcome}`;
  });
  const done = lines.length ? `${lines.join('; ')}.` : '';
  const summary = note ? `${note} ${done}`.trim() : lines.length ? `Completed the task. ${done}` : 'Nothing needed doing for this task.';
  return {
    text: 'That covers this task.',
    toolCalls: [{ name: toWireName('task.finish'), input: { summary } }],
  };
}

function pickRead(reads: ResolvedTool[], pack: ResolvedPack, text: string): ResolvedTool | undefined {
  const mentioned = mentionedEntity(pack, text);
  return (
    reads.find((t) => t.fixedArgs.entity && t.fixedArgs.entity === mentioned?.name) ??
    reads.find((t) => t.primitive.name === 'records.search' && !t.fixedArgs.entity) ??
    reads.find((t) => t.primitive.name === 'records.search') ??
    reads[0]
  );
}

function readArgs(tool: ResolvedTool, pack: ResolvedPack, text: string): Record<string, unknown> {
  if (tool.primitive.name === 'knowledge.search') return { query: truncate(text, 60) };
  const entityName = (tool.fixedArgs.entity as string | undefined) ?? mentionedEntity(pack, text)?.name ?? pack.entities[0]?.name;
  const entity = pack.entities.find((e) => e.name === entityName);
  const filter: Record<string, string> = {};
  const lower = text.toLowerCase();
  for (const f of entity?.fields ?? []) {
    if (f.type !== 'enum') continue;
    const option = f.options?.find((o) => new RegExp(`\\b${o}\\b`, 'i').test(lower));
    if (option) filter[f.name] = option;
  }
  // Narrow to the person the goal is about, when it names one.
  const person = personIn(text);
  return { entity: entityName, ...(person && { query: person }), ...(Object.keys(filter).length && { filter }), limit: 10 };
}

function actionArgs(
  tool: ResolvedTool,
  pack: ResolvedPack,
  text: string,
  found: Record<string, unknown>[],
): Record<string, unknown> | null {
  const target = found[0];
  const contact = contactOf(target, text);
  // Never invent money: the amount must come from the goal or the record.
  const amount = amountIn(text) ?? numberField(target, ['amount', 'budget', 'price', 'value', 'totalPrice']);
  const entity = (tool.fixedArgs.entity as string | undefined) ?? mentionedEntity(pack, text)?.name ?? pack.entities[0]?.name;

  switch (tool.primitive.name) {
    case 'records.create': {
      const def = pack.entities.find((e) => e.name === entity);
      return def ? { entity, data: synthesizeRecord(def, text) } : null;
    }
    case 'records.update':
      return target?.id ? { entity, id: target.id, patch: {} } : null;
    case 'message.draft':
    case 'message.send':
      return {
        channel: contact.includes('@') ? 'email' : 'whatsapp',
        to: contact,
        subject: contact.includes('@') ? truncate(text.split('\n')[0]!, 60) : undefined,
        body: `Hello${nameOf(target, text) ? ` ${nameOf(target, text)!.split(' ')[0]}` : ''}, this is a quick note from our team regarding: ${truncate(text.split('\n')[0]!, 120)}. Please reply here if you have any questions.`,
      };
    case 'payment.request':
      if (amount === null) return null;
      return { amount, currency: 'INR', payer: nameOf(target, text) ?? contact, purpose: truncate(text.split('\n')[0]!, 80) };
    case 'refund.issue':
      if (amount === null) return null;
      return {
        amount,
        currency: 'INR',
        recipient: nameOf(target, text) ?? contact,
        reason: /because ([^.\n]+)/i.exec(text)?.[1]?.trim() ?? 'Customer request',
        ...(target?.id ? { recordRef: target.id } : {}),
      };
    case 'schedule.create': {
      const start = new Date(Date.now() + 86_400_000);
      start.setUTCHours(4, 30, 0, 0); // 10:00 IST
      return { title: truncate(text.split('\n')[0]!, 80), start: start.toISOString(), attendees: contact ? [contact] : [] };
    }
    case 'document.generate': {
      const kind = /itinerar/i.test(text) ? 'itinerary' : /quote|quotation/i.test(text) ? 'quote' : /invoice|bill/i.test(text) ? 'invoice' : 'report';
      const rows = found.slice(0, 5).map((r) => `- ${nameOf(r) ?? r.id}`).join('\n');
      return { kind, title: truncate(text.split('\n')[0]!, 80), content: `# ${truncate(text.split('\n')[0]!, 80)}\n\n${text}\n\n${rows ? `## Related records\n${rows}` : ''}` };
    }
    default:
      return null;
  }
}

function describeIntent(tool: ResolvedTool): string {
  return tool.description.charAt(0).toLowerCase() + tool.description.slice(1).replace(/\.$/, '');
}

function latestRecords(history: OfflineHistoryItem[]): Record<string, unknown>[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i]!.result as { records?: Record<string, unknown>[] } | null;
    if (history[i]!.status === 'executed' && Array.isArray(r?.records) && r.records.length) return r.records;
  }
  return [];
}

function mentionedEntity(pack: ResolvedPack, text: string): EntityDef | undefined {
  const find = (t: string) => {
    const lower = t.toLowerCase();
    return pack.entities.find((e) => [e.name, e.label, e.plural_label].filter(Boolean).some((n) => lower.includes(n!.toLowerCase())));
  };
  // The task title says what this step is about; the rest of the text is context.
  return find(text.split('\n')[0] ?? '') ?? find(text);
}

function amountIn(text: string): number | null {
  const m = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(text) ?? /\b(\d{1,3}(?:,\d{2,3})+|\d{3,7})\b/.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numberField(r: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const k of keys) if (typeof r?.[k] === 'number') return r[k] as number;
  return null;
}

/** "Refund ₹12,000 to Asha Menon" → "Asha Menon". */
function personIn(text: string): string | null {
  return /\b(?:to|for|from|with)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(text)?.[1] ?? null;
}

function nameOf(r: Record<string, unknown> | undefined, text = ''): string | null {
  if (!r) return personIn(text);
  const key = Object.keys(r).find((k) => /name$/i.test(k) && typeof r[k] === 'string');
  return key ? (r[key] as string) : null;
}

function contactOf(r: Record<string, unknown> | undefined, text: string): string {
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(text)?.[0];
  if (email) return email;
  if (r) {
    if (typeof r.phone === 'string') return r.phone;
    if (typeof r.email === 'string') return r.email;
  }
  return nameOf(r, text) ?? 'the customer';
}

function synthesizeRecord(entity: EntityDef, text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const person = /(?:for|from|customer|client|patient|guest|traveller|student)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(text)?.[1];
  const place = /\bto\s+([A-Z][a-z]+)/.exec(text)?.[1];
  for (const f of entity.fields) {
    const key = f.name.toLowerCase();
    if (!f.required && !['status', 'phone', 'email', 'amount', 'budget'].some((k) => key.includes(k))) continue;
    switch (f.type) {
      case 'enum':
        out[f.name] = f.options?.[0];
        break;
      case 'money':
      case 'number':
        out[f.name] = amountIn(text) ?? 0;
        break;
      case 'integer':
        out[f.name] = 1;
        break;
      case 'boolean':
        out[f.name] = true;
        break;
      case 'date':
        out[f.name] = day(7);
        break;
      case 'datetime':
        out[f.name] = new Date().toISOString();
        break;
      case 'email': {
        const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(text)?.[0];
        if (email) out[f.name] = email;
        break;
      }
      case 'phone': {
        const phone = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.exec(text)?.[0];
        if (phone) out[f.name] = phone;
        break;
      }
      default:
        out[f.name] = key.includes('name')
          ? (person ?? 'New customer')
          : key.includes('destination') || key.includes('city')
            ? (place ?? 'To be confirmed')
            : truncate(text.split('\n')[0]!, 120);
    }
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
