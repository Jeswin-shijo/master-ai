import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { pushTokens } from '../db/schema';

/**
 * Notifications. Push goes through the Expo push service to the owner's
 * phones; email, WhatsApp and SMS channels plug in here as connectors arrive.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DbService) {}

  async pushToTenant(tenantId: string, message: { title: string; body: string; data?: Record<string, unknown> }) {
    const tokens = await this.db.tenant(tenantId, (tx) => tx.select({ token: pushTokens.token }).from(pushTokens));
    if (tokens.length === 0) return;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map(({ token }) => ({ to: token, sound: 'default', priority: 'high', ...message }))),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.logger.warn(`Expo push failed: ${res.status}`);
    } catch (err) {
      this.logger.warn(`Expo push failed: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
