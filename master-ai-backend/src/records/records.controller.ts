import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateRecordInputSchema } from '@onehuman/schemas';
import type { z } from 'zod';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { RecordsService } from './records.service';

@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('records/:entity')
  list(@CurrentSession() s: Session, @Param('entity') entity: string, @Query('q') q?: string) {
    return this.records.list(s.tenantId, entity, q || undefined);
  }

  @Post('records/:entity')
  create(
    @CurrentSession() s: Session,
    @Param('entity') entity: string,
    @Body(new ZodPipe(CreateRecordInputSchema)) body: z.output<typeof CreateRecordInputSchema>,
  ) {
    return this.records.createFromApi(s.tenantId, s.principalId, entity, body.data);
  }

  @Get('outbox')
  outbox(@CurrentSession() s: Session) {
    return this.records.outbox(s.tenantId);
  }
}
