import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Bot,
  Check,
  Clock,
  CreditCard,
  Database,
  FileText,
  Flag,
  Hand,
  Mail,
  Phone,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Delegation } from '@onehuman/schemas';
import type { GoalDetail } from '@onehuman/sdk';
import { cn } from '@/lib/utils';

/**
 * n8n-style canvas for one goal: trigger → plan → agent tasks, with each
 * task's actions hanging below it as round sub-nodes (like an n8n AI agent's
 * tools). Phone delegations show the person and their three call stages.
 */

export type CanvasSelection =
  | { kind: 'goal' }
  | { kind: 'plan' }
  | { kind: 'task'; id: string }
  | { kind: 'call'; id: string }
  | { kind: 'delegation'; id: string };

type Tone = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'blocked';

interface StepData extends Record<string, unknown> {
  icon: LucideIcon;
  label: string;
  sub?: string;
  tone: Tone;
  trigger?: boolean;
  selected?: boolean;
  badge?: string;
}

interface SubData extends Record<string, unknown> {
  icon: LucideIcon;
  label: string;
  tone: Tone;
  selected?: boolean;
  stages?: { stage: string; tone: Tone }[];
  level?: number;
}

const TONE_RING: Record<Tone, string> = {
  idle: 'border-border',
  running: 'border-info',
  waiting: 'border-warning',
  done: 'border-success',
  failed: 'border-danger',
  blocked: 'border-danger',
};

function StatusDot({ tone }: { tone: Tone }) {
  if (tone === 'done') return <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-success text-white"><Check className="size-3" strokeWidth={3} /></span>;
  if (tone === 'waiting') return <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-warning text-black"><Clock className="size-3" strokeWidth={3} /></span>;
  if (tone === 'failed' || tone === 'blocked') return <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-danger text-white"><X className="size-3" strokeWidth={3} /></span>;
  return null;
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const Icon = data.icon;
  return (
    <div className="relative flex w-36 flex-col items-center pb-1">
      <div
        className={cn(
          'relative grid size-[88px] place-items-center border-2 bg-surface shadow-lg shadow-black/20 transition-colors',
          data.trigger ? 'rounded-l-[44px] rounded-r-xl' : 'rounded-xl',
          TONE_RING[data.tone],
          data.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-canvas',
        )}
      >
        {data.tone === 'running' && <span className="absolute inset-[-5px] animate-pulse rounded-[inherit] border-2 border-info/40" aria-hidden />}
        <Icon className={cn('size-8', data.trigger ? 'text-primary' : 'text-fg')} strokeWidth={1.6} aria-hidden />
        <StatusDot tone={data.tone} />
        {data.badge && (
          <span className="absolute -top-2 -left-2 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] leading-5 font-semibold text-white" title="Actions taken">
            {data.badge}
          </span>
        )}
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
      <p className="mt-2 line-clamp-2 text-center text-xs font-medium text-fg">{data.label}</p>
      {data.sub && <p className="line-clamp-1 text-center text-[11px] text-fg-muted">{data.sub}</p>}
      {/* Sub-node connector leaves below the label so the dashed line never crosses text. */}
      <Handle id="sub" type="source" position={Position.Bottom} />
    </div>
  );
}

const STAGE_TONE: Record<Tone, string> = {
  idle: 'bg-muted border border-border',
  running: 'bg-info',
  waiting: 'bg-warning',
  done: 'bg-success',
  failed: 'bg-danger',
  blocked: 'bg-danger',
};

function SubNode({ data }: NodeProps<Node<SubData>>) {
  const Icon = data.icon;
  return (
    <div className="flex w-28 flex-col items-center">
      <div
        className={cn(
          'relative grid size-14 place-items-center rounded-full border-2 bg-surface',
          TONE_RING[data.tone],
          data.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-canvas',
        )}
      >
        <Icon className="size-6 text-fg" strokeWidth={1.6} aria-hidden />
        <StatusDot tone={data.tone} />
        <Handle type="target" position={Position.Top} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-center text-[11px] font-medium text-fg">{data.label}</p>
      {data.level && <p className="text-[10px] text-fg-muted">L{data.level}</p>}
      {data.stages && (
        <div className="mt-1 flex gap-1" aria-label="Call stages">
          {data.stages.map((s) => (
            <span key={s.stage} title={s.stage} className={cn('size-2 rounded-full', STAGE_TONE[s.tone])} />
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { step: StepNode, sub: SubNode };

function toolIcon(tool: string): LucideIcon {
  if (tool.startsWith('message')) return Mail;
  if (tool.startsWith('payment') || tool.startsWith('refund')) return CreditCard;
  if (tool.startsWith('document')) return FileText;
  if (tool.startsWith('human')) return Hand;
  if (tool.startsWith('staff')) return Phone;
  if (tool.includes('search') || tool.startsWith('records') || tool.startsWith('knowledge')) return Database;
  return Zap;
}

function taskTone(status: string): Tone {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'waiting_approval' || status === 'waiting_on_team' || status === 'paused') return 'waiting';
  if (status === 'escalated') return 'blocked';
  if (status === 'failed') return 'failed';
  return 'idle';
}

function callTone(status: string): Tone {
  if (status === 'executed') return 'done';
  if (status === 'awaiting_approval' || status === 'running') return 'waiting';
  if (status === 'blocked' || status === 'rejected' || status === 'failed' || status === 'expired') return 'failed';
  return 'running';
}

function delegationTone(d: Delegation): Tone {
  if (d.status === 'done') return 'done';
  if (['declined', 'blocked', 'not_done', 'unreachable'].includes(d.status)) return 'blocked';
  return 'waiting';
}

function stageTones(d: Delegation): { stage: string; tone: Tone }[] {
  return (['assign', 'follow_up', 'confirm'] as const).map((stage) => {
    const calls = d.calls.filter((c) => c.stage === stage);
    const last = calls[calls.length - 1];
    if (!last) return { stage, tone: d.stage === stage ? 'running' : 'idle' };
    if (last.status === 'ringing' || last.status === 'in_progress') return { stage, tone: 'running' };
    if (last.status === 'no_answer') return { stage, tone: 'waiting' };
    if (['declined', 'blocked', 'not_done', 'unclear'].includes(last.outcome ?? '')) return { stage, tone: 'blocked' };
    return { stage, tone: 'done' };
  });
}

const COL = 210;
const ROW = 300;
const SUB_Y = 165;
const SUB_GAP = 112;

export function GoalCanvas({
  detail,
  delegations,
  selected,
  onSelect,
}: {
  detail: GoalDetail;
  delegations: Delegation[];
  selected: CanvasSelection | null;
  onSelect: (s: CanvasSelection) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const { goal, tasks, toolCalls } = detail;
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const isSel = (s: CanvasSelection) => JSON.stringify(s) === JSON.stringify(selected);
    const edge = (source: string, target: string, opts: Partial<Edge> = {}): Edge => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      ...opts,
    });

    const goalTone: Tone = goal.status === 'completed' ? 'done' : goal.status === 'failed' ? 'failed' : goal.status === 'cancelled' ? 'blocked' : 'running';
    nodes.push({ id: 'goal', type: 'step', position: { x: 0, y: 0 }, data: { icon: Flag, label: 'Goal', sub: goal.text, tone: goalTone, trigger: true, selected: isSel({ kind: 'goal' }) } });
    const planTone: Tone = goal.status === 'planning' ? 'running' : goal.status === 'awaiting_plan_approval' ? 'waiting' : goal.status === 'cancelled' ? 'blocked' : 'done';
    nodes.push({ id: 'plan', type: 'step', position: { x: COL, y: 0 }, data: { icon: Sparkles, label: 'Orchestrator', sub: goal.plan ? `${goal.plan.tasks.length} task(s)` : 'planning…', tone: planTone, selected: isSel({ kind: 'plan' }) } });
    edges.push(edge('goal', 'plan', { animated: planTone === 'running' }));

    // Columns by dependency depth.
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    const depth = new Map<string, number>();
    const depthOf = (key: string, seen = new Set<string>()): number => {
      if (depth.has(key)) return depth.get(key)!;
      if (seen.has(key)) return 0;
      seen.add(key);
      const t = byKey.get(key);
      const d = t && t.dependsOn.length ? 1 + Math.max(...t.dependsOn.map((k) => depthOf(k, seen))) : 0;
      depth.set(key, d);
      return d;
    };
    const rows = new Map<number, number>();
    for (const t of tasks) {
      const d = depthOf(t.key);
      const row = rows.get(d) ?? 0;
      rows.set(d, row + 1);
      const id = `task:${t.id}`;
      const x = COL * (2 + d);
      const y = row * ROW;
      const steps = toolCalls.filter((c) => c.taskId === t.id);
      nodes.push({
        id,
        type: 'step',
        position: { x, y },
        data: { icon: Bot, label: t.title, sub: t.agentName, tone: taskTone(t.status), selected: isSel({ kind: 'task', id: t.id }), badge: steps.length ? `${steps.length}` : undefined },
      });
      if (t.dependsOn.length === 0) edges.push(edge('plan', id, { animated: t.status === 'running' }));
      for (const dep of t.dependsOn) {
        const from = byKey.get(dep);
        if (from) edges.push(edge(`task:${from.id}`, id, { animated: t.status === 'running' }));
      }

      // Sub-nodes: this task's actions (latest 5), delegations shown as phone nodes.
      const subs = steps.slice(-5);
      const width = (subs.length - 1) * SUB_GAP;
      subs.forEach((c, i) => {
        const deleg = delegations.find((d) => d.toolCallId === c.id);
        const subId = deleg ? `delegation:${deleg.id}` : `call:${c.id}`;
        nodes.push({
          id: subId,
          type: 'sub',
          position: { x: x + 16 + i * SUB_GAP - width / 2, y: y + SUB_Y },
          data: deleg
            ? { icon: Phone, label: deleg.staffName, tone: delegationTone(deleg), stages: stageTones(deleg), selected: isSel({ kind: 'delegation', id: deleg.id }) }
            : { icon: c.status === 'awaiting_approval' ? ShieldAlert : toolIcon(c.tool), label: c.tool, tone: callTone(c.status), level: c.decision?.level, selected: isSel({ kind: 'call', id: c.id }) },
        });
        edges.push({
          id: `${id}=>${subId}`,
          source: id,
          sourceHandle: 'sub',
          target: subId,
          type: 'default',
          style: { strokeDasharray: '5 5', opacity: 0.7 },
        });
      });
    }
    return { nodes, edges };
  }, [detail, delegations, selected]);

  return (
    <div className="h-[460px] overflow-hidden rounded-xl border border-border bg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          const [kind, id] = node.id.split(':') as [string, string | undefined];
          if (kind === 'goal' || kind === 'plan') onSelect({ kind });
          else if (kind === 'task' || kind === 'call' || kind === 'delegation') onSelect({ kind, id: id! });
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--oh-canvas-dot)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
