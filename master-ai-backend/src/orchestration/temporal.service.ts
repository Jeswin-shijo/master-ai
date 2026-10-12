import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { config } from '../config';
import { SIGNALS, type ApprovalDecisionSignal, type CallUpdateSignal, type GoalWorkflowInput, type PlanDecisionSignal } from './shared';

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
