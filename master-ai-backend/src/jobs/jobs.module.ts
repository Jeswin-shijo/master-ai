import { Module } from '@nestjs/common';
import { DataModule } from '../data.module';
import { JobRunnerService } from './job-runner.service';

/**
 * Jobs: scripted agent work (read, ask the AI, check, act). The app's agent
 * runtime injects the runner from here; the runner reads the company's data
 * through DataModule, so neither module imports the app.
 */
@Module({
  imports: [DataModule],
  providers: [JobRunnerService],
  exports: [JobRunnerService],
})
export class JobsModule {}
