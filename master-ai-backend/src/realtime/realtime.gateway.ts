import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { BeforeApplicationShutdown, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RealtimeEvent } from '@onehuman/schemas';
import { readStreamTicket } from '../common/auth';
import { DbService } from '../db/db.service';
import { principals } from '../db/schema';
import { BusService, subjects } from '../events/bus.service';

/**
 * One live stream per signed-in client at ws(s)://host/realtime?ticket=… (a one-minute
 * ticket from POST /auth/stream-ticket; the session token never goes in a URL).
 * Every committed audit event for the client's tenant is pushed as it happens,
 * so the web command center and the mobile app stay in sync.
 */
@Injectable()
export class RealtimeGateway implements OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Map<string, Set<WebSocket>>();
  private unsubscribe: (() => void) | null = null;
  private server: HttpServer | null = null;

  constructor(
    private readonly bus: BusService,
    private readonly db: DbService,
  ) {}

  attach(server: HttpServer) {
    this.server = server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/realtime') return;
      const session = readStreamTicket(url.searchParams.get('ticket') ?? '');
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      void this.db
        .tenant(session.tenantId, (tx) => tx.select({ status: principals.status }).from(principals).where(eq(principals.id, session.principalId)))
        .then(([p]) => {
          if (p?.status !== 'active') {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => this.register(session.tenantId, ws));
        })
        .catch(() => socket.destroy());
    });

    this.unsubscribe = this.bus.subscribe<RealtimeEvent>(subjects.allEvents, (event, subject) => {
      const tenantId = subject.split('.').pop()!;
      const payload = JSON.stringify(event);
      for (const ws of this.clients.get(tenantId) ?? []) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    });
    this.logger.log('Realtime gateway listening on /realtime');
  }

  private register(tenantId: string, ws: WebSocket) {
    const set = this.clients.get(tenantId) ?? new Set();
    set.add(ws);
    this.clients.set(tenantId, set);
    ws.send(JSON.stringify({ kind: 'hello' }));
    const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 25_000);
    ws.on('close', () => {
      clearInterval(ping);
      set.delete(ws);
      if (set.size === 0) this.clients.delete(tenantId);
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    // Open WebSockets and SSE streams would keep the HTTP server from closing,
    // which hangs restarts (node --watch, deploys). Drop them first.
    for (const set of this.clients.values()) for (const ws of set) ws.terminate();
    this.wss.close();
  }

  beforeApplicationShutdown() {
    this.server?.closeAllConnections();
  }
}
