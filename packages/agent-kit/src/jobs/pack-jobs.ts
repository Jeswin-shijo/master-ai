import type { JobCheck, JobDef, PolicyRule, ResolvedPack } from '@onehuman/schemas';
import { registersOf } from '../registers';
import { resolveTool } from '../tools';
import { lifecycleOf } from '../lifecycle/resolve';
import type { EffectiveEscalation } from './words';

type Agents = ResolvedPack['agents'];

/** The policy id for a tool a job card forbids: job-forbid-front-desk-refund-issue. */
export const jobForbidId = (role: string, tool: string) => `job-forbid-${role}-${tool.replace(/\./g, '-')}`;

/** One forbid policy per tool a job card forbids, so the policy engine refuses it whatever an agent tries. */
export function jobForbidPolicies(agents: Agents): PolicyRule[] {
  return agents.flatMap((a) =>
    (a.job?.forbid ?? []).map((tool): PolicyRule => ({
      id: jobForbidId(a.role, tool),
      action: tool,
      agent: a.role,
      forbid: true,
      approver: 'owner',
      reason: `Never handled by ${a.name}`,
    })),
  );
}

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * The escalation sets one agent obeys: the pack's `all` sets, then its customer sets when the card
 * says customer-facing, then the agent's own. An own set with a shared id merges into the shared one.
 */
export function escalationsFor(pack: Pick<ResolvedPack, 'agents' | 'escalations'>, role: string): EffectiveEscalation[] {
  const card = pack.agents.find((a) => a.role === role)?.job;
  const shared = (pack.escalations ?? []).filter(
    (s) => (s.for ?? 'all') === 'all' || (s.for === 'customer_facing' && card?.customer_facing === true),
  );
  const ordered = [...shared.filter((s) => (s.for ?? 'all') === 'all'), ...shared.filter((s) => s.for === 'customer_facing')];
  const out: EffectiveEscalation[] = ordered.map((s) => ({
    id: s.id,
    label: s.label,
    words: [...s.words],
    reply: s.reply ?? null,
    alert: s.alert,
    inherited: true,
    fromPack: true,
  }));
  for (const own of card?.escalate ?? []) {
    const hit = out.find((e) => e.inherited && e.id === own.id);
    if (hit) {
      hit.words = unique([...hit.words, ...own.words]);
      hit.label = own.label;
      hit.reply = own.reply ?? hit.reply;
      hit.alert = own.alert;
    } else {
      out.push({ id: own.id, label: own.label, words: [...own.words], reply: own.reply ?? null, alert: own.alert, inherited: false, fromPack: true });
    }
  }
  return out;
}

export const jobsFor = (pack: Pick<ResolvedPack, 'jobs'>, role: string): JobDef[] => (pack.jobs ?? []).filter((j) => j.agent === role);

export const jobById = (pack: Pick<ResolvedPack, 'jobs'>, id: string): JobDef | undefined => (pack.jobs ?? []).find((j) => j.id === id);

const TEMPLATE = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const BARE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const NAME = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/g;

/** Paths in `{{ }}` placeholders of any string inside the value. */
function templatePaths(v: unknown, into: string[] = []): string[] {
  if (typeof v === 'string') for (const m of v.matchAll(TEMPLATE)) into.push(m[1]!);
  else if (Array.isArray(v)) v.forEach((x) => templatePaths(x, into));
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => templatePaths(x, into));
  return into;
}

/** A spec that is a template or a bare path (a plain number or sentence gives none). */
function specPaths(spec: unknown): string[] {
  if (typeof spec !== 'string') return [];
  if (spec.includes('{{')) return templatePaths(spec);
  return BARE.test(spec.trim()) ? [spec.trim()] : [];
}

/** Every path a check reads. */
function checkPaths(c: JobCheck): string[] {
  if (c.escalate) return templatePaths(c.escalate.text);
  if (c.required) return c.required.fields.flatMap(specPaths);
  if (c.in_data) return [c.in_data.value, c.in_data.among].flatMap(specPaths);
  if (c.limit) return [c.limit.value, c.limit.max, c.limit.min].flatMap(specPaths);
  if (c.adds_up) return [c.adds_up.total, ...c.adds_up.plus, ...c.adds_up.minus].flatMap(specPaths);
  if (c.within_days) return specPaths(c.within_days.date);
  if (c.duplicate) return templatePaths(c.duplicate.key);
  if (c.says_not) return specPaths(c.says_not.text);
  if (c.valid) return specPaths(c.valid.value);
  if (c.calc) return c.calc.expr.match(NAME) ?? [];
  return [];
}

const first = (path: string) => path.split('.')[0]!;

/** Walks act arguments; reports each path with whether it sits under an `amount` key. */
function argPaths(v: unknown, underAmount: boolean, out: { path: string; amount: boolean }[] = []) {
  if (typeof v === 'string') for (const m of v.matchAll(TEMPLATE)) out.push({ path: m[1]!, amount: underAmount });
  else if (Array.isArray(v)) v.forEach((x) => argPaths(x, underAmount, out));
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) argPaths(x, underAmount || k === 'amount', out);
  }
  return out;
}

/** Cross-reference and safety checks on the pack's jobs. Messages name the job and the problem. */
export function validateJobs(pack: ResolvedPack): string[] {
  const issues: string[] = [];
  const entities = new Set(pack.entities.map((e) => e.name));
  const lists = registersOf(pack);
  const categories = new Set(lifecycleOf(pack).categories.map((c) => c.id));
  const seenIds = new Set<string>();

  for (const job of pack.jobs ?? []) {
    const at = `job ${job.id}`;
    if (seenIds.has(job.id)) issues.push(`${at}: defined twice`);
    seenIds.add(job.id);

    const agent = pack.agents.find((a) => a.role === job.agent);
    if (!agent) issues.push(`${at}: unknown agent ${job.agent}`);
    else if (!agent.job) issues.push(`${at}: agent ${job.agent} has no job card`);

    const t = job.trigger;
    if (t.request) {
      for (const id of t.request.categories) if (!categories.has(id)) issues.push(`${at}: trigger names unknown request category ${id}`);
    }
    if (t.record && !entities.has(t.record.entity)) issues.push(`${at}: trigger names unknown record type ${t.record.entity}`);
    if (t.list) {
      const list = lists.find((r) => r.id === t.list!.list);
      if (!list) issues.push(`${at}: trigger names unknown list ${t.list.list}`);
      else {
        const due = t.list.due;
        const field = 'overdue' in due ? due.overdue.date : due.expiring.date;
        if (!list.entity.fields.some((f) => f.name === field)) issues.push(`${at}: trigger due date ${field} is not a field of ${list.entity.name}`);
      }
    }

    const known = new Set<string>(['trigger', 'today']);
    const names = new Set<string>();
    const pointsAt = (where: string, paths: string[]) => {
      for (const p of paths) {
        if (!known.has(first(p))) issues.push(`${at} ${where}: {{ ${p} }} does not start with trigger, today or an earlier step's name`);
      }
    };
    const define = (where: string, as: string) => {
      if (as === 'trigger' || as === 'today' || names.has(as)) issues.push(`${at} ${where}: name ${as} is used twice (names must be unique)`);
      names.add(as);
      known.add(as);
    };
    const tainted = new Set<string>();
    const escalations = escalationsFor(pack, job.agent);

    job.steps.forEach((step, i) => {
      const where = `step ${i + 1}`;
      if (step.read) {
        const r = step.read;
        if (r.from === 'records') {
          if (!r.entity) issues.push(`${at} ${where}: reading records needs a record type`);
          else if (!entities.has(r.entity)) issues.push(`${at} ${where}: unknown record type ${r.entity}`);
        }
        if (r.from === 'list') {
          if (!r.list) issues.push(`${at} ${where}: reading a list needs a list`);
          else if (!lists.some((l) => l.id === r.list)) issues.push(`${at} ${where}: unknown list ${r.list}`);
        }
        if (r.query) pointsAt(where, templatePaths(r.query));
        define(where, r.as);
      } else if (step.ai) {
        const a = step.ai;
        for (const n of a.data) if (!known.has(first(n))) issues.push(`${at} ${where}: data names ${n}, which is not an earlier result`);
        pointsAt(where, templatePaths(a.offline ?? {}));
        for (const f of a.output) if (f.type === 'choice' && !f.options?.length) issues.push(`${at} ${where}: choice field ${f.name} needs options`);
        define(where, a.as);
        tainted.add(a.as);
      } else if (step.check) {
        const c = step.check;
        const paths = checkPaths(c);
        pointsAt(where, paths);
        if (c.escalate && escalations.length === 0) issues.push(`${at} ${where}: an escalate check needs at least one escalation set for ${job.agent}`);
        if (c.as) {
          define(where, c.as);
          if (c.calc && paths.some((p) => tainted.has(first(p)))) tainted.add(c.as);
        }
      } else if (step.act) {
        const a = step.act;
        const tool = resolveTool(pack, a.tool);
        if (!tool) issues.push(`${at} ${where}: unknown tool ${a.tool}`);
        else {
          if (agent && !agent.tools.includes(a.tool)) issues.push(`${at} ${where}: agent ${job.agent} does not hold ${a.tool}`);
          if (agent?.job?.forbid.includes(a.tool)) issues.push(`${at} ${where}: ${a.tool} is on the forbid list of ${job.agent}`);
        }
        const refs = argPaths(a.args, false);
        pointsAt(where, refs.map((r) => r.path));
        const movesMoney = tool?.risk.movesMoney === true;
        for (const r of refs) {
          if ((r.amount || movesMoney) && tainted.has(first(r.path))) {
            issues.push(
              `${at} ${where}: money argument uses {{ ${r.path} }}, which comes from the AI; money amounts and payment details must come from records or checks`,
            );
          }
        }
        define(where, a.as);
      }
    });
  }
  return issues;
}

