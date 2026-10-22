import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { JobSwitchInputSchema, RunJobInputSchema, type JobSwitchInput, type RunJobInput } from '@onehuman/schemas';
import { CurrentSession, ManagersOnly, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { JobsService } from './jobs.service';

/** Everyone in the company sees the jobs and their runs; the owner and admins switch and run them. */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentSession() s: Session) {
    return this.jobs.list(s.tenantId);
  }

  @Get(':id/runs')
  runs(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.jobs.runs(s.tenantId, id);
  }

  /** Switch a job on or off, or change its daily cap. */
  @ManagersOnly()
  @Patch(':id')
  switch(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(JobSwitchInputSchema)) body: JobSwitchInput) {
    return this.jobs.switch(s, id, body);
  }

  /** Run now, with what the person typed in. A request with no body at all (Express 5 leaves it undefined) is a run with no text. */
  @ManagersOnly()
  @Post(':id/run')
  run(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(RunJobInputSchema.default({}))) body: RunJobInput) {
    return this.jobs.runNow(s, id, body);
  }
}
