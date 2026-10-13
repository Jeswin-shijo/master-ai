import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CheckinInputSchema,
  CreateRoutineInputSchema,
  UpdateRoutineInputSchema,
  type CheckinInput,
  type CreateRoutineInput,
  type UpdateRoutineInput,
} from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { RoutinesService } from './routines.service';

@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  list(@CurrentSession() s: Session) {
    return this.routines.list(s.tenantId);
  }

  /** Check-ins the industry setup offers, ready to switch on. */
  @Get('templates')
  templates(@CurrentSession() s: Session) {
    return this.routines.templates(s.tenantId);
  }

  @ManagersOnly()
  @Post()
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateRoutineInputSchema)) body: CreateRoutineInput) {
    return this.routines.create(s, body);
  }

  @Get(':id')
  day(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Query('date') date?: string) {
    return this.routines.day(s.tenantId, id, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @ManagersOnly()
  @Patch(':id')
  update(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateRoutineInputSchema)) body: UpdateRoutineInput) {
    return this.routines.update(s, id, body);
  }

  /** Fill in today's check-in by hand. */
  @Post(':id/checkins')
  submit(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CheckinInputSchema)) body: CheckinInput) {
    return this.routines.submit(s, id, body);
  }

  /** Call everyone who has not reported today, right now. */
  @Post(':id/run')
  run(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.routines.runNow(s, id);
  }
}
