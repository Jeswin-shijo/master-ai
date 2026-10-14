import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectRealtime } from './realtime';

class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
  close() {
    this.onclose?.();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('connectRealtime', () => {
  afterEach(() => {
    FakeSocket.opened = [];
    vi.useRealTimers();
  });

  it('opens the stream with a fresh one-minute ticket, never the session token', async () => {
    const conn = connectRealtime({ baseUrl: 'https://api.example.com/', ticket: async () => 'tk-1', onEvent: () => {}, WebSocketImpl: FakeSocket as never });
    await flush();
    expect(FakeSocket.opened.map((s) => s.url)).toEqual(['wss://api.example.com/realtime?ticket=tk-1']);
    conn.close();
  });

  it('asks for a new ticket each time it reconnects, since the last one has expired', async () => {
    let n = 0;
    const conn = connectRealtime({ baseUrl: 'http://localhost:3000', ticket: async () => `tk-${++n}`, onEvent: () => {}, WebSocketImpl: FakeSocket as never });
    await flush();
    FakeSocket.opened[0]!.close(); // the server dropped it
    await new Promise((r) => setTimeout(r, 600)); // first backoff is 500 ms
    expect(FakeSocket.opened.map((s) => s.url)).toEqual(['ws://localhost:3000/realtime?ticket=tk-1', 'ws://localhost:3000/realtime?ticket=tk-2']);
    conn.close();
  });

  it('keeps trying with backoff when a ticket cannot be had (offline), and stops once closed', async () => {
    vi.useFakeTimers();
    let asked = 0;
    const statuses: string[] = [];
    const conn = connectRealtime({
      baseUrl: 'http://localhost:3000',
      ticket: async () => {
        asked++;
        throw new Error('offline');
      },
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: FakeSocket as never,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(asked).toBe(2);
    conn.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toBe(2);
    expect(FakeSocket.opened).toHaveLength(0);
    expect(statuses).toContain('closed');
  });
});
