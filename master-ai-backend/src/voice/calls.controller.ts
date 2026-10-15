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

  /** Calls about list items are left out for members. */
  @Get('calls')
  list(@CurrentSession() s: Session, @Query('status') status?: string) {
    return status === 'active' ? this.calls.activeFor(s) : this.calls.listFor(s);
  }

  @Get('calls/:id')
  get(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.getFor(s, id);
  }

  /** Simulator: pick up as the staff member. */
  @Post('calls/:id/answer')
  async answer(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    await this.simulated(s, id);
    return this.calls.answerFor(s, id);
  }

  /** Simulator: say something as the staff member; the AI replies. */
  @Post('calls/:id/reply')
  async reply(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CallReplyInputSchema)) body: CallReplyInput) {
    await this.simulated(s, id);
    return this.calls.replyFor(s, id, body.text);
  }

  /** Simulator: let it ring out / reject the call. */
  @Post('calls/:id/decline')
  async decline(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    await this.simulated(s, id);
    return this.calls.declineFor(s, id);
  }

  /** Real calls are answered on the phone, never from the web app. A call this person may not handle is not found first, so it says nothing about it. */
  private async simulated(s: Session, callId: string) {
    const call = await this.calls.raw(s.tenantId, callId);
    if (!call) return;
    this.calls.assertCanHandle(s, call);
    if (call.provider !== 'simulator') throw new BadRequestException('This is a real phone call; it can only be answered on the phone.');
  }

  @Get('delegations')
  delegationsList(@CurrentSession() s: Session, @Query('goalId') goalId?: string) {
    return this.delegations.listDelegations(s.tenantId, goalId || undefined);
  }
}
