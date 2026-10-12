import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CallReplyInputSchema, type CallReplyInput } from '@onehuman/schemas';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { DelegationService } from './delegation.service';

@Controller()
export class CallsController {
  constructor(private readonly delegations: DelegationService) {}

  @Get('calls')
  list(@CurrentSession() s: Session, @Query('status') status?: string) {
    return status === 'active' ? this.delegations.active(s.tenantId) : this.delegations.listCalls(s.tenantId);
  }

  @Get('calls/:id')
  get(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegations.getCall(s.tenantId, id);
  }

  /** Simulator: pick up as the staff member. */
  @Post('calls/:id/answer')
  answer(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegations.answer(s, id);
  }

  /** Simulator: say something as the staff member; the AI replies. */
  @Post('calls/:id/reply')
  reply(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CallReplyInputSchema)) body: CallReplyInput) {
    return this.delegations.reply(s, id, body.text);
  }

  /** Simulator: let it ring out / reject the call. */
  @Post('calls/:id/decline')
  decline(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.delegations.decline(s, id);
  }

  @Get('delegations')
  delegationsList(@CurrentSession() s: Session, @Query('goalId') goalId?: string) {
    return this.delegations.listDelegations(s.tenantId, goalId || undefined);
  }
}
