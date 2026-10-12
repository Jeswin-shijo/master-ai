import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { RealtimeGateway } from './realtime/realtime.gateway';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
  app.get(RealtimeGateway).attach(app.getHttpServer());
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`API on http://localhost:${config.PORT} (LLM ${config.llmOffline ? 'offline mode' : 'online'})`, 'Bootstrap');
}

void bootstrap();
