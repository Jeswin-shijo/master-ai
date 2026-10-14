import type { RealtimeEvent } from '@onehuman/schemas';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeOptions {
  baseUrl: string;
  /** A fresh one-minute stream ticket (`api.auth.streamTicket`), asked for on every connect. */
  ticket: () => Promise<string>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Injected for React Native or tests; defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * One live event stream per signed-in client. Reconnects with backoff; callers
 * should refetch on `open` to cover anything missed while disconnected.
 */
export function connectRealtime(options: RealtimeOptions): { close: () => void } {
  const WS = options.WebSocketImpl ?? globalThis.WebSocket;
  const base = `${options.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/realtime`;
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const retry = () => {
    options.onStatus?.('closed');
    if (closed) return;
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    timer = setTimeout(() => void open(), delay);
  };

  const open = async () => {
    if (closed) return;
    options.onStatus?.('connecting');
    let ticket: string;
    try {
      ticket = await options.ticket();
    } catch {
      retry(); // offline, or the session has ended
      return;
    }
    if (closed) return;
    socket = new WS(`${base}?ticket=${encodeURIComponent(ticket)}`);
    socket.onopen = () => {
      attempt = 0;
      options.onStatus?.('open');
    };
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as RealtimeEvent | { kind: 'hello' };
        if (data.kind === 'event') options.onEvent(data);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = retry;
    socket.onerror = () => socket?.close();
  };
  void open();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    },
  };
}
