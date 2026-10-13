import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { principals, pushTokens } from '../db/schema';
import { pushAudience } from './audience';

type PushMessage = { title: string; body: string; data?: Record<string, unknown> };

/**
 * Notifications. Push goes through the Expo push service to the phones of
 * the people who should act; email, WhatsApp and SMS channels plug in here as connectors arrive.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DbService) {}

  /** Company news (plans ready, escalations, needs-info): the owner and admins. */
  async pushToManagers(tenantId: string, message: PushMessage) {
    await this.pushTo(tenantId, 'managers', message);
  }

  /** An approval routed to a role: its holders and the owner ("owner" means the owner and admins). */
  async pushToRole(tenantId: string, role: string, message: PushMessage) {
    await this.pushTo(tenantId, { role }, message);
  }

  private async pushTo(tenantId: string, target: { role: string } | 'managers', message: PushMessage) {
    const tokens = await this.db.tenant(tenantId, async (tx) => {
      const people = await tx
        .select({ id: principals.id, role: principals.role, status: principals.status, approverRoles: principals.approverRoles })
        .from(principals)
        .where(eq(principals.kind, 'human'));
      const ids = pushAudience(people, target);
      if (ids.length === 0) return [];
      return tx.select({ token: pushTokens.token }).from(pushTokens).where(inArray(pushTokens.principalId, ids));
    });
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
