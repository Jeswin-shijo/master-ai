import { BadRequestException } from '@nestjs/common';
import { escalationsFor } from '@onehuman/agent-kit';
import { JobCardSchema, type AgentJobCardView, type EscalationSet, type JobCard, type JobCardEdit, type PackAgent, type ResolvedPack } from '@onehuman/schemas';

export const PACK_SET_KEPT = "A safety word set that came with the pack can't be removed or shortened";

interface AgentRow {
  role: string;
  spec: PackAgent;
}

type Pack = Pick<ResolvedPack, 'agents' | 'escalations'>;
type EditedSets = NonNullable<JobCardEdit['escalate']>;

/** The card an agent works by: its own (the owner may have edited it), else its pack's. */
export function cardOf(agent: AgentRow, pack: Pack): JobCard | undefined {
  return agent.spec.job ?? pack.agents.find((a) => a.role === agent.role)?.job;
}

/** The pack with only this agent in it, carrying this card, for `escalationsFor`. */
const withCard = (agent: AgentRow, pack: Pack, card: JobCard): Pack => ({
  agents: [{ ...agent.spec, role: agent.role, job: card }],
  escalations: pack.escalations ?? [],
});

/** The card as owners read it. Every set the pack gave this agent is marked `fromPack`. */
export function jobCardView(agent: AgentRow, pack: Pack): AgentJobCardView | null {
  const card = cardOf(agent, pack);
  if (!card) return null;
  const fromPack = new Set(escalationsFor(pack, agent.role).map((s) => s.id));
  return {
    mission: card.mission,
    may: agent.spec.tools.filter((t) => !card.forbid.includes(t)),
    never: card.never,
    customerFacing: card.customer_facing,
    escalations: escalationsFor(withCard(agent, pack, card), agent.role).map((s) => ({ ...s, fromPack: fromPack.has(s.id) })),
    forbidden: card.forbid,
    trialDays: card.trial_days,
  };
}

const fold = (w: string) => w.normalize('NFC').trim().toLowerCase();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const trimmed = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Words once each, however they are written ("Fire" and "fire " are one word). */
function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words.map((w) => w.trim())) {
    if (!word || seen.has(fold(word))) continue;
    seen.add(fold(word));
    out.push(word);
  }
  return out;
}

/** The same words, whatever their order, case or repeats (a pack set may list one twice). */
function sameWords(a: string[], b: string[]): boolean {
  const [x, y] = [new Set(a.map(fold)), new Set(b.map(fold))];
  return x.size === y.size && [...x].every((w) => y.has(w));
}

/**
 * Applies an owner's edit to the agent's card and says which parts changed.
 * `escalate` lists every set the agent should have, as the card shows them; each
 * set the pack gave the agent must still be there with all of its pack words.
 */
export function editJobCard(agent: AgentRow, pack: Pack, edit: JobCardEdit): { card: JobCard; changed: (keyof JobCardEdit)[] } {
  const live = cardOf(agent, pack);
  if (!live && !edit.mission) throw new BadRequestException('This agent has no job card yet. Give it a mission first.');
  const before: JobCard = live ?? JobCardSchema.parse({ mission: edit.mission });
  const card: JobCard = { ...before };
  if (edit.mission !== undefined) card.mission = edit.mission.trim();
  if (edit.never !== undefined) card.never = trimmed(edit.never);
  if (edit.escalate !== undefined) card.escalate = ownSets(agent, pack, before, edit.escalate);
  const parts = ['mission', 'never', 'escalate'] as const;
  const changed = live ? parts.filter((k) => !same(before[k], card[k])) : parts.filter((k) => edit[k] !== undefined);
  return { card, changed };
}

/**
 * The sets to store on the card. An inherited set the owner left as it came is
 * not stored (the shared set covers it). One the owner changed is stored under
 * the shared id, with the label, alert and reply it had unless the owner changed
 * those too, so the merge in `escalationsFor` never moves its alert.
 */
function ownSets(agent: AgentRow, pack: Pack, card: JobCard, edited: EditedSets): EscalationSet[] {
  const ids = edited.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new BadRequestException('Two word sets have the same id');

  for (const kept of escalationsFor(pack, agent.role)) {
    const now = edited.find((s) => s.id === kept.id);
    const words = new Set((now?.words ?? []).map(fold));
    if (!now || !kept.words.every((w) => words.has(fold(w)))) throw new BadRequestException(PACK_SET_KEPT);
  }

  const shared = escalationsFor(withCard(agent, pack, { ...card, escalate: [] }), agent.role);
  const current = escalationsFor(withCard(agent, pack, card), agent.role);
  const own: EscalationSet[] = [];
  for (const e of edited) {
    const was = current.find((s) => s.id === e.id);
    const reply = e.reply ?? was?.reply ?? undefined;
    const set: EscalationSet = { id: e.id, label: e.label.trim(), words: uniqueWords(e.words), alert: e.alert ?? was?.alert ?? 'owner', ...(reply && { reply }) };
    const inherited = shared.find((s) => s.id === e.id);
    const asItCame =
      inherited && sameWords(set.words, inherited.words) && set.label === inherited.label && set.alert === inherited.alert && (set.reply ?? null) === inherited.reply;
    if (!asItCame) own.push(set);
  }
  return own;
}
