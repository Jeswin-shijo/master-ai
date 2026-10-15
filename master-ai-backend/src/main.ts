import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers';
import { config } from './config';
import { RealtimeGateway } from './realtime/realtime.gateway';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  // Public rate limits key on the client address; behind a proxy it comes from X-Forwarded-For.
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['X-Export-Truncated', 'X-Export-Limit'] });
  app.enableShutdownHooks();
  app.get(RealtimeGateway).attach(app.getHttpServer());
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`API on http://localhost:${config.PORT} (LLM ${config.llmOffline ? 'offline mode' : config.llmProvider})`, 'Bootstrap');
}

void bootstrap();
