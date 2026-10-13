import { useMemo } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, UserRound, X } from 'lucide-react';
import { STAGE_KEYS, type StageKey } from '@onehuman/schemas';
import { dotLabel, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

/** Someone the case waits on (an approver, the requester), or who is doing the work. */
export interface CasePerson {
  stage: StageKey;
  name: string;
  doing: string;
  waiting: boolean;
}

interface StageData extends Record<string, unknown> {
  stage: StageKey;
  n: number;
  name: string;
  state: DotState;
  selected: boolean;
  person: CasePerson | null;
}

const GAP_X = 190;
const ROW_Y = 236;
/** Everything drawn, labels included, so fitView keeps the labels in view. */
const FRAME = { x: -48, y: -24, w: 3 * GAP_X + 76 + 96, h: ROW_Y + 76 + 170 };

const LABEL_TONE: Record<DotState, string> = {
  done: 'text-success',
  live: 'text-fg-body',
  waiting: 'text-warning',
  todo: 'text-fg-muted',
  skipped: 'text-fg-muted',
  stopped: 'text-danger',
};

const RING: Record<DotState, string> = {
  done: 'shadow-[inset_0_0_0_1.5px_var(--oh-success)]',
  live: 'shadow-[inset_0_0_0_1.5px_var(--oh-glow)]',
  waiting: 'shadow-[inset_0_0_0_1.5px_var(--oh-warning)]',
  todo: 'outline-1 -outline-offset-1 outline-dashed outline-line-20',
  skipped: 'shadow-[inset_0_0_0_1px_var(--oh-line10)]',
  stopped: 'shadow-[inset_0_0_0_1.5px_var(--oh-danger)]',
};

function StageNode({ data }: NodeProps<Node<StageData, 'stage'>>) {
  const { stage, n, name, state, selected, person } = data;
  return (
    <div
      data-stage={stage}
      data-stage-state={state}
      className={cn(
        'relative size-[76px] rounded-lg bg-node',
        state === 'live' && 'live-node',
        state === 'skipped' && 'opacity-60',
        selected && 'outline-2 outline-offset-4 outline-accent',
      )}
    >
      {state === 'live' && (
        <span className="absolute inset-0 overflow-hidden rounded-lg" aria-hidden>
          <span className="live-spin" />
          <span className="absolute inset-[1.5px] rounded-[10.5px] bg-node" />
        </span>
      )}
      {(state === 'live' || state === 'waiting') && <span className={cn('live-halo', state === 'waiting' && 'live-halo-warm')} aria-hidden />}
      <span className={cn('absolute inset-0 rounded-lg', RING[state])} aria-hidden />
      <span className={cn('relative grid size-full place-items-center font-display text-2xl tabular-nums', state === 'todo' || state === 'skipped' ? 'text-fg-muted' : 'text-fg')}>
        {n}
      </span>
      {state === 'done' && (
        <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-success-soft text-success shadow-[inset_0_0_0_1px_var(--oh-success)]">
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )}
      {state === 'stopped' && (
        <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-danger-soft text-danger shadow-[inset_0_0_0_1px_var(--oh-danger)]">
          <X className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )}
      {/* Ports, as on n8n nodes: green once the stage is done. */}
      <span className={cn('absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full', state === 'done' ? 'bg-success' : 'bg-line-20')} aria-hidden />
      <span className={cn('absolute top-1/2 -right-1 size-2 -translate-y-1/2 rounded-full', state === 'done' ? 'bg-success' : 'bg-line-20')} aria-hidden />
      <Handle id="l-in" type="target" position={Position.Left} />
      <Handle id="r-out" type="source" position={Position.Right} />
      <Handle id="r-in" type="target" position={Position.Right} />
      <Handle id="l-out" type="source" position={Position.Left} />
      <div className="absolute top-full left-1/2 mt-3 w-[150px] -translate-x-1/2 text-center">
        <p className="line-clamp-2 text-sm leading-tight font-medium text-fg">{name}</p>
        <p className={cn('mt-1 text-xs', LABEL_TONE[state])}>{dotLabel(state)}</p>
        {person && (
          <div className="glass-warm mt-2.5 flex items-center gap-2 rounded-md p-2 text-left" data-person>
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-warning-soft text-warning', person.waiting && 'pulse-dot')}>
              <UserRound className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-fg">{person.name}</span>
              <span className="block truncate text-xs text-fg-lead">{person.doing}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FrameNode() {
  return <div style={{ width: FRAME.w, height: FRAME.h }} aria-hidden />;
}

const nodeTypes = { stage: StageNode, frame: FrameNode };
const behind = (s: DotState | undefined) => s === 'done' || s === 'skipped';

/**
 * The 8 stages in two rows of four: 1–4 left to right, then 5–8 right to left
 * under them, so every name stays readable without zooming out.
 */
export function CaseCanvas({
  states,
  names,
  person,
  selected,
  onSelect,
}: {
  states: DotState[];
  names: string[];
  person: CasePerson | null;
  selected: StageKey | null;
  onSelect: (stage: StageKey) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      { id: 'frame', type: 'frame', position: { x: FRAME.x, y: FRAME.y }, data: {}, selectable: false, focusable: false, style: { pointerEvents: 'none' } },
    ];
    STAGE_KEYS.forEach((stage, i) => {
      const x = i < 4 ? i * GAP_X : (7 - i) * GAP_X;
      const data: StageData = { stage, n: i + 1, name: names[i] ?? stage, state: states[i] ?? 'todo', selected: selected === stage, person: person?.stage === stage ? person : null };
      nodes.push({ id: stage, type: 'stage', position: { x, y: i < 4 ? 0 : ROW_Y }, data });
    });
    const edges: Edge[] = STAGE_KEYS.slice(1).map((target, j) => {
      const source = STAGE_KEYS[j]!;
      const from = states[j];
      const to = states[j + 1];
      const className = behind(to) ? 'edge-done' : behind(from) && (to === 'live' || to === 'waiting') ? 'edge-live' : 'edge-todo';
      // 4 → 5 turns down on the right; the second row runs right to left.
      if (j === 3) return { id: `${source}-${target}`, source, target, sourceHandle: 'r-out', targetHandle: 'r-in', type: 'smoothstep', pathOptions: { offset: 48, borderRadius: 18 }, className };
      if (j > 3) return { id: `${source}-${target}`, source, target, sourceHandle: 'l-out', targetHandle: 'r-in', type: 'straight', className };
      return { id: `${source}-${target}`, source, target, sourceHandle: 'r-out', targetHandle: 'l-in', type: 'straight', className };
    });
    return { nodes, edges };
  }, [states, names, person, selected]);

  return (
    <div className="glass h-[500px] overflow-hidden rounded-lg" data-testid="case-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.type === 'stage') onSelect(node.id as StageKey);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--oh-canvas-dot)" />
      </ReactFlow>
    </div>
  );
}
