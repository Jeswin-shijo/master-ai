import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, StringCodec, type NatsConnection, type Subscription } from 'nats';
import type { AgentTextChunk, RealtimeEvent } from '@onehuman/schemas';
import { config } from '../config';

const sc = StringCodec();

export const subjects = {
  events: (tenantId: string) => `onehuman.events.${tenantId}`,
  allEvents: 'onehuman.events.*',
  agentText: (tenantId: string, taskId: string) => `onehuman.text.${tenantId}.${taskId}`,
};

/**
 * NATS event bus. Audit events are published after commit; a JetStream stream
 * keeps them durable for future consumers (ClickHouse KPIs, process mining).
 */
@Injectable()
export class BusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusService.name);
  private nc: NatsConnection | null = null;
  private ready: Promise<void> | null = null;

  onModuleInit() {
    void this.whenReady();
  }

  private async connect() {
    try {
      this.nc = await connect({ servers: config.NATS_URL, name: 'onehuman-backend', maxReconnectAttempts: -1, waitOnFirstConnect: true });
      const jsm = await this.nc.jetstreamManager();
      await jsm.streams.add({ name: 'ONEHUMAN_EVENTS', subjects: ['onehuman.events.>'], max_age: 30 * 24 * 3600 * 1e9 }).catch(async () => {
        await jsm.streams.update('ONEHUMAN_EVENTS', { subjects: ['onehuman.events.>'] });
      });
    } catch (err) {
      this.logger.warn(`NATS unavailable (${(err as Error).message}); realtime updates are off`);
    }
  }

  /** Connects on first use, so subscribers registered before module init still work. */
  whenReady(): Promise<void> {
    this.ready ??= this.connect();
    return this.ready;
  }

  publishEvent(tenantId: string, event: RealtimeEvent) {
    this.publish(subjects.events(tenantId), event);
  }

  publishText(tenantId: string, chunk: AgentTextChunk) {
    this.publish(subjects.agentText(tenantId, chunk.taskId), chunk);
  }

  private publish(subject: string, data: unknown) {
    if (!this.nc || this.nc.isClosed()) return;
    this.nc.publish(subject, sc.encode(JSON.stringify(data)));
  }

  /** Subscribe to a subject; returns an unsubscribe function. */
  subscribe<T>(subject: string, onMessage: (data: T, subject: string) => void): () => void {
    let sub: Subscription | null = null;
    let cancelled = false;
    void this.whenReady().then(() => {
      if (cancelled || !this.nc) return;
      sub = this.nc.subscribe(subject, {
        callback: (err, msg) => {
          if (err) return;
          try {
            onMessage(JSON.parse(sc.decode(msg.data)) as T, msg.subject);
          } catch {
            // Ignore malformed messages.
          }
        },
      });
    });
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }

  async onModuleDestroy() {
    await this.nc?.drain().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [BusService], exports: [BusService] })
export class BusModule {}
