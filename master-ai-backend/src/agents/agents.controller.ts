import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AutonomyOverrideInputSchema, UpdateAgentInputSchema, type AutonomyOverrideInput, type UpdateAgentInput } from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { AgentsService } from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(@CurrentSession() s: Session) {
    return this.agents.list(s.tenantId);
  }

  @Get('autonomy/suggestions')
  suggestions(@CurrentSession() s: Session) {
    return this.agents.suggestions(s.tenantId);
  }

  @Get(':id')
  get(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.get(s.tenantId, id);
  }

  @ManagersOnly()
  @Patch(':id')
  update(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateAgentInputSchema)) body: UpdateAgentInput) {
    return this.agents.update(s, id, body);
  }

  @ManagersOnly()
  @Post(':id/pause')
  pause(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.setPaused(s, id, true);
  }

  @ManagersOnly()
  @Post(':id/resume')
  resume(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.setPaused(s, id, false);
  }

  @ManagersOnly()
  @Post(':id/overrides')
  addOverride(
    @CurrentSession() s: Session,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AutonomyOverrideInputSchema)) body: AutonomyOverrideInput,
  ) {
    return this.agents.addOverride(s, id, body);
  }

  @ManagersOnly()
  @Delete(':id/overrides/:overrideId')
  removeOverride(
    @CurrentSession() s: Session,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('overrideId', ParseUUIDPipe) overrideId: string,
  ) {
    return this.agents.removeOverride(s, id, overrideId);
  }
}
