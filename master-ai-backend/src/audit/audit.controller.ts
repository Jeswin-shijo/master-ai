import { Controller, Get, Query } from '@nestjs/common';
import { CurrentSession, type Session } from '../common/auth';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @CurrentSession() s: Session,
    @Query('goalId') goalId?: string,
    @Query('limit') limit?: string,
    @Query('beforeSeq') beforeSeq?: string,
  ) {
    return this.audit.list(s.tenantId, {
      goalId: goalId || undefined,
      limit: limit ? Number(limit) : undefined,
      beforeSeq: beforeSeq ? Number(beforeSeq) : undefined,
    });
  }

  @Get('verify')
  verify(@CurrentSession() s: Session) {
    return this.audit.verify(s.tenantId);
  }
}
