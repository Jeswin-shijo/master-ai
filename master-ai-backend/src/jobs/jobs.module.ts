import { Module } from '@nestjs/common';
import { DataModule } from '../data.module';
import { TemporalModule } from '../orchestration/temporal.service';
import { JobRunnerService } from './job-runner.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/**
 * Jobs: scripted agent work (read, ask the AI, check, act). The app's agent
 * runtime injects the runner from here, and onboarding and cases start runs
 * through JobsService. The runner reads the company's data through DataModule
 * and runs start through the one TemporalService (TemporalModule), so neither
 * module imports the app.
 */
@Module({
  imports: [DataModule, TemporalModule],
  controllers: [JobsController],
  providers: [JobRunnerService, JobsService],
  exports: [JobRunnerService, JobsService],
})
export class JobsModule {}
