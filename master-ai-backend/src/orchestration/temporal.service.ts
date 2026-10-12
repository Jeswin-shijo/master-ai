import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client, Connection, DAYS_OF_WEEK, ScheduleNotFoundError, ScheduleOverlapPolicy, WorkflowNotFoundError } from '@temporalio/client';
import { config } from '../config';
import {
  SIGNALS,
  type ApprovalDecisionSignal,
  type CallUpdateSignal,
  type GoalWorkflowInput,
  type PlanDecisionSignal,
  type RoutineRunInput,
} from './shared';

export const goalWorkflowId = (goalId: string) => `goal-${goalId}`;
export const taskWorkflowId = (taskId: string) => `task-${taskId}`;

/** Temporal client used by the API: start goals, deliver approvals, pause and resume tasks. */
@Injectable()
export class TemporalService implements OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private clientPromise: Promise<Client> | null = null;
  private connection: Connection | null = null;

  private client(): Promise<Client> {
    this.clientPromise ??= Connection.connect({ address: config.TEMPORAL_ADDRESS }).then((connection) => {
      this.connection = connection;
      return new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    });
    this.clientPromise.catch(() => {
      this.clientPromise = null;
    });
    return this.clientPromise;
  }

  async startGoal(input: GoalWorkflowInput): Promise<string> {
    const client = await this.client();
    const workflowId = goalWorkflowId(input.goalId);
    await client.workflow.start('goalWorkflow', {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [input],
    });
    return workflowId;
  }

  async decidePlan(goalId: string, decision: PlanDecisionSignal) {
    await this.signal(goalWorkflowId(goalId), SIGNALS.planDecision, decision);
  }

  async deliverApproval(taskId: string, decision: ApprovalDecisionSignal) {
    await this.signal(taskWorkflowId(taskId), SIGNALS.approvalDecision, decision);
  }

  /** A simulated or real call was answered or ended: wake the delegation workflow. */
  async signalCall(delegationId: string, update: CallUpdateSignal) {
    await this.signal(`delegation-${delegationId}`, SIGNALS.callUpdate, update);
  }

  /** A check-in call was answered or ended: wake its call workflow. */
  async signalCheckin(entryId: string, update: CallUpdateSignal) {
    await this.signal(`checkin-${entryId}`, SIGNALS.callUpdate, update);
  }

  /** Run a routine now ("Run now", or a test): calls whoever has not reported today. */
  async startRoutineRun(input: RoutineRunInput): Promise<string> {
    const client = await this.client();
    const workflowId = `routine-${input.routineId}-${Date.now()}`;
    await client.workflow.start('routineRunWorkflow', { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowId, args: [input] });
    return workflowId;
  }

  /**
   * Keep a routine's Temporal schedule in step with it: on its days at its
   * time (India time), start a run. Paused routines keep a paused schedule.
   */
  async syncRoutineSchedule(r: { tenantId: string; routineId: string; days: number[]; time: string; active: boolean }) {
    const client = await this.client();
    const scheduleId = `routine-${r.routineId}`;
    const [hour, minute] = r.time.split(':').map(Number) as [number, number];
    try {
      await client.schedule.getHandle(scheduleId).delete();
    } catch (err) {
      if (!(err instanceof ScheduleNotFoundError)) throw err;
    }
    await client.schedule.create({
      scheduleId,
      spec: { calendars: [{ dayOfWeek: r.days.map((d) => DAYS_OF_WEEK[d]!), hour, minute }], timezone: 'Asia/Kolkata' },
      action: {
        type: 'startWorkflow',
        workflowType: 'routineRunWorkflow',
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: scheduleId,
        args: [{ tenantId: r.tenantId, routineId: r.routineId, trigger: 'schedule' } satisfies RoutineRunInput],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      state: { paused: !r.active, note: r.active ? undefined : 'Routine paused by the owner' },
    });
  }

  async pauseTasks(taskIds: string[]) {
    await Promise.all(taskIds.map((id) => this.signal(taskWorkflowId(id), SIGNALS.pause, undefined)));
  }

  async resumeTasks(taskIds: string[]) {
    await Promise.all(taskIds.map((id) => this.signal(taskWorkflowId(id), SIGNALS.resume, undefined)));
  }

  private async signal(workflowId: string, name: string, arg: unknown) {
    const client = await this.client();
    try {
      const handle = client.workflow.getHandle(workflowId);
      if (arg === undefined) await handle.signal(name);
      else await handle.signal(name, arg);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        this.logger.warn(`Workflow ${workflowId} not running; signal ${name} dropped`);
        return;
      }
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.connection?.close().catch(() => undefined);
  }
}
