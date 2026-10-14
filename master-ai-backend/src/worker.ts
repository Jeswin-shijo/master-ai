import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AppModule } from './app.module';
import { config } from './config';
import { createActivities } from './orchestration/activities';

/**
 * Temporal worker: runs goal and task workflows and their activities. It
 * reuses the same Nest modules as the API (no HTTP), so there is one
 * implementation of every rule.
 */
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('./orchestration/workflows'),
    activities: createActivities(app),
  });
  Logger.log(`Worker polling "${config.TEMPORAL_TASK_QUEUE}" (LLM ${config.llmOffline ? 'offline mode' : config.llmProvider})`, 'Worker');
  await worker.run();
  await connection.close();
  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
