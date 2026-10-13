/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '@onehuman/schemas';

/**
 * The phone's saved approvals and queued decisions, run against a real SQLite
 * (Node's built-in one standing in for expo-sqlite). Two people can sign in on
 * the same phone, one after the other; neither may see the other's list.
 */

const signedIn = vi.hoisted(() => ({ principalId: 'sunita' }));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const db = new DatabaseSync(':memory:');
    return {
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params),
      getAllAsync: async (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params),
      withTransactionAsync: async (work: () => Promise<void>) => {
        db.exec('BEGIN');
        await work();
        db.exec('COMMIT');
      },
    };
  },
}));
vi.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: () => undefined }) }));
vi.mock('../src/lib/session', () => ({ useSession: { getState: () => ({ user: { principalId: signedIn.principalId } }) } }));
vi.mock('../src/lib/api', () => ({
  // No signal: every send fails as a network error, so decisions queue.
  api: { approvals: { decide: async () => Promise.reject(new TypeError('Network request failed')) } },
  isNetworkError: () => true,
  queryClient: { invalidateQueries: async () => undefined },
}));

const { cacheApprovals, cachedApprovals, queuedDecisions, submitDecision } = await import('../src/lib/offline');

const approval = (id: string) => ({ id, createdAt: '2026-10-13T10:00:00Z', summary: `Approve ${id}` }) as ApprovalRequest;
const decision = (approvalId: string) => ({ approvalId, decision: 'approved' as const, signature: 'sig', keyId: 'key', signedAt: '2026-10-13T10:01:00Z' });

describe('the saved approvals on a shared phone', () => {
  beforeEach(() => {
    signedIn.principalId = 'sunita';
  });

  it("shows each person only their own saved list, never the last person's", async () => {
    await cacheApprovals([approval('hot-work-gate')]);
    signedIn.principalId = 'manoj';
    expect(await cachedApprovals()).toEqual([]);
    await cacheApprovals([]);
    signedIn.principalId = 'sunita';
    expect((await cachedApprovals()).map((a) => a.id)).toEqual(['hot-work-gate']);
  });

  it('keeps a decision queued without signal with the person who signed it', async () => {
    expect(await submitDecision(decision('hot-work-gate'))).toBe('queued');
    signedIn.principalId = 'manoj';
    expect(await queuedDecisions()).toEqual([]);
    signedIn.principalId = 'sunita';
    expect((await queuedDecisions()).map((d) => d.approvalId)).toEqual(['hot-work-gate']);
  });
});
