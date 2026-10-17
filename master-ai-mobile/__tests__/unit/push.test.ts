import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The push-tap listener: what it opens, once, and where it stays quiet. */

const env = vi.hoisted(() => ({ os: 'android', isDevice: true, execution: 'standalone' }));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return env.os;
    },
  },
}));
vi.mock('expo-device', () => ({
  get isDevice() {
    return env.isDevice;
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get executionEnvironment() {
      return env.execution;
    },
  },
  ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
}));
vi.mock('../../src/lib/api', () => ({ api: {} }));

type Response = { notification: { request: { identifier: string; content: { data: unknown } } } };
const tap = (identifier: string, data: unknown = { listId: 'bills', itemId: 'i1' }): Response => ({ notification: { request: { identifier, content: { data } } } });

function fakeNotifications(last: Response | null) {
  let listener: ((r: Response) => void) | null = null;
  const remove = vi.fn();
  const mod = {
    getLastNotificationResponse: vi.fn(() => last),
    clearLastNotificationResponse: vi.fn(),
    addNotificationResponseReceivedListener: vi.fn((fn: (r: Response) => void) => {
      listener = fn;
      return { remove };
    }),
  };
  return { mod: mod as unknown as typeof import('expo-notifications'), raw: mod, remove, emit: (r: Response) => listener?.(r) };
}

let openPushTaps: typeof import('../../src/lib/push').openPushTaps;
beforeEach(async () => {
  env.os = 'android';
  env.isDevice = true;
  env.execution = 'standalone';
  vi.resetModules(); // the last opened push is module state
  ({ openPushTaps } = await import('../../src/lib/push'));
});

describe('opening a tapped push', () => {
  it('does nothing on the web', () => {
    env.os = 'web';
    const load = vi.fn();
    const stop = openPushTaps(vi.fn(), load);
    expect(load).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
  });

  it('does nothing in Expo Go', () => {
    env.execution = 'storeClient';
    const load = vi.fn();
    openPushTaps(vi.fn(), load)();
    expect(load).not.toHaveBeenCalled();
  });

  it('opens the push that started the app once, then clears it', () => {
    const n = fakeNotifications(tap('p1'));
    const open = vi.fn();
    openPushTaps(open, () => n.mod);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatchObject({ params: { id: 'bills', itemId: 'i1' } });
    expect(n.raw.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('opens a later tap, but not the same push twice', () => {
    const n = fakeNotifications(tap('p1'));
    const open = vi.fn();
    const stop = openPushTaps(open, () => n.mod);
    n.emit(tap('p1'));
    expect(open).toHaveBeenCalledTimes(1);
    n.emit(tap('p2'));
    expect(open).toHaveBeenCalledTimes(2);
    stop();
    expect(n.remove).toHaveBeenCalled();
  });

  it('stays quiet when the module will not load or reading the last tap throws', () => {
    const open = vi.fn();
    const boom = openPushTaps(open, () => {
      throw new Error('no push here');
    });
    expect(boom()).toBeUndefined();
    const n = fakeNotifications(null);
    n.raw.getLastNotificationResponse.mockImplementation(() => {
      throw new Error('broken');
    });
    expect(openPushTaps(open, () => n.mod)()).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
