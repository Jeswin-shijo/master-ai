import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CallReplyInputSchema, type CallReplyInput } from '@onehuman/schemas';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { CallsService } from './calls.service';
import { DelegationService } from './delegation.service';

@Controller()
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly delegations: DelegationService,
  ) {}

  @Get('calls')
  list(@CurrentSession() s: Session, @Query('status') status?: string) {
    return status === 'active' ? this.calls.active(s.tenantId) : this.calls.list(s.tenantId);
  }

  @Get('calls/:id')
  get(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.get(s.tenantId, id);
  }

  /** Simulator: pick up as the staff member. */
  @Post('calls/:id/answer')
  async answer(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    await this.simulated(s.tenantId, id);
    return this.calls.answer(s.tenantId, id);
  }

  /** Simulator: say something as the staff member; the AI replies. */
  @Post('calls/:id/reply')
  async reply(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CallReplyInputSchema)) body: CallReplyInput) {
    await this.simulated(s.tenantId, id);
    return this.calls.reply(s.tenantId, id, body.text);
  }

  /** Simulator: let it ring out / reject the call. */
  @Post('calls/:id/decline')
  async decline(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    await this.simulated(s.tenantId, id);
    return this.calls.decline(s.tenantId, id);
  }

  /** Real calls are answered on the phone, never from the web app. */
  private async simulated(tenantId: string, callId: string) {
    const call = await this.calls.raw(tenantId, callId);
    if (call && call.provider !== 'simulator') throw new BadRequestException('This is a real phone call; it can only be answered on the phone.');
  }

  @Get('delegations')
  delegationsList(@CurrentSession() s: Session, @Query('goalId') goalId?: string) {
    return this.delegations.listDelegations(s.tenantId, goalId || undefined);
  }
}
