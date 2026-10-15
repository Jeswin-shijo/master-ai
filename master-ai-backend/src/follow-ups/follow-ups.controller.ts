import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { SwitchFollowUpInputSchema } from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { FollowUpsService } from './follow-ups.service';

/** A list's follow-up calls: their switches, and "Call now". The owner and admins only; the service keeps party calls to the owner. */
@ManagersOnly()
@Controller()
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Get('lists/:id/follow-ups')
  list(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.followUps.forList(s, id);
  }

  @Put('follow-ups/:key')
  switch(@CurrentSession() s: Session, @Param('key') key: string, @Body(new ZodPipe(SwitchFollowUpInputSchema)) body: z.output<typeof SwitchFollowUpInputSchema>) {
    return this.followUps.switch(s, key, body.enabled);
  }

  @Post('follow-ups/run')
  run(@CurrentSession() s: Session) {
    return this.followUps.runNow(s);
  }
}
