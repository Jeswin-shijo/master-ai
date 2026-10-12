import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreateGoalInputSchema, PlanDecisionInputSchema, type AgentTextChunk, type CreateGoalInput, type PlanDecisionInput } from '@onehuman/schemas';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { BusService, subjects } from '../events/bus.service';
import { GoalsService } from './goals.service';

@Controller()
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly bus: BusService,
  ) {}

  @Post('goals')
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateGoalInputSchema)) body: CreateGoalInput) {
    return this.goals.create(s, body);
  }

  @Get('goals')
  list(@CurrentSession() s: Session) {
    return this.goals.list(s.tenantId);
  }

  @Get('goals/:id')
  detail(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.detail(s.tenantId, id);
  }

  @Post('goals/:id/plan-decision')
  decidePlan(
    @CurrentSession() s: Session,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PlanDecisionInputSchema)) body: PlanDecisionInput,
  ) {
    return this.goals.decidePlan(s, id, body);
  }

  /** Server-sent events: the agent's words as it decides each step. */
  @Get('tasks/:id/stream')
  stream(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const unsubscribe = this.bus.subscribe<AgentTextChunk>(subjects.agentText(s.tenantId, id), (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
