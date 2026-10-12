import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApprovalDecisionInputSchema, BatchApprovalInputSchema, type ApprovalDecisionInput, type BatchApprovalInput } from '@onehuman/schemas';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentSession() s: Session, @Query('status') status?: string) {
    return this.approvals.list(s.tenantId, status === 'all' ? 'all' : 'pending');
  }

  @Post('batch')
  batch(@CurrentSession() s: Session, @Body(new ZodPipe(BatchApprovalInputSchema)) body: BatchApprovalInput) {
    return this.approvals.batch(s, body);
  }

  @Get(':id')
  get(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.get(s.tenantId, id);
  }

  @Post(':id/decide')
  decide(
    @CurrentSession() s: Session,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ApprovalDecisionInputSchema)) body: ApprovalDecisionInput,
  ) {
    return this.approvals.decide(s, id, body);
  }
}
