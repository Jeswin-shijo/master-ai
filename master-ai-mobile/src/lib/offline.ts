import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { ApiError } from '@onehuman/sdk';
import type { ApprovalRequest } from '@onehuman/schemas';
import { api, isNetworkError, queryClient } from './api';
import type { SignedDecision } from './device-key';
import { useSession } from './session';

/**
 * Offline-first approvals: the pending list is cached in SQLite so it can be
 * read with no signal, and decisions signed offline are queued and sent as soon
 * as the phone is back online. Signatures carry their own timestamp, so a
 * queued decision is still provably the owner's.
 *
 * Several people can use one phone, one after the other, so every row belongs
 * to the person (principal) who was signed in: nobody sees another person's
 * saved list, and a queued decision is only ever sent from its signer's session.
 */

/** The signed-in person; rows are kept per person. */
const owner = () => useSession.getState().user?.principalId ?? '';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= SQLite.openDatabaseAsync('onehuman.db').then(async (d) => {
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS approvals_cache;
      DROP TABLE IF EXISTS decision_queue;
      CREATE TABLE IF NOT EXISTS saved_approvals (owner TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner, id));
      CREATE TABLE IF NOT EXISTS queued_decisions (owner TEXT NOT NULL, approval_id TEXT NOT NULL, json TEXT NOT NULL, queued_at TEXT NOT NULL, PRIMARY KEY (owner, approval_id));
    `);
    return d;
  });
  return dbPromise;
}

export async function cacheApprovals(list: ApprovalRequest[]) {
  const d = await db();
  const who = owner();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM saved_approvals WHERE owner = ?', who);
    for (const a of list) {
      await d.runAsync('INSERT INTO saved_approvals (owner, id, json, created_at) VALUES (?, ?, ?, ?)', who, a.id, JSON.stringify(a), a.createdAt);
    }
  });
}

export async function cachedApprovals(): Promise<ApprovalRequest[]> {
  const rows = await (await db()).getAllAsync<{ json: string }>('SELECT json FROM saved_approvals WHERE owner = ? ORDER BY created_at DESC', owner());
  return rows.map((r) => JSON.parse(r.json) as ApprovalRequest);
}

export async function queuedDecisions(): Promise<SignedDecision[]> {
  const rows = await (await db()).getAllAsync<{ json: string }>('SELECT json FROM queued_decisions WHERE owner = ? ORDER BY queued_at', owner());
  return rows.map((r) => JSON.parse(r.json) as SignedDecision);
}

/** Send now if possible, otherwise queue. Returns 'sent' or 'queued'. */
export async function submitDecision(d: SignedDecision): Promise<'sent' | 'queued'> {
  try {
    await api.approvals.decide(d.approvalId, d);
    return 'sent';
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await (await db()).runAsync(
      'INSERT OR REPLACE INTO queued_decisions (owner, approval_id, json, queued_at) VALUES (?, ?, ?, ?)',
      owner(),
      d.approvalId,
      JSON.stringify(d),
      new Date().toISOString(),
    );
    return 'queued';
  }
}

let flushing = false;

/** Deliver queued decisions. Rejected ones (expired, already decided) are dropped. */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const d = await db();
    for (const item of await queuedDecisions()) {
      try {
        await api.approvals.decide(item.approvalId, item);
        sent++;
      } catch (err) {
        if (isNetworkError(err)) break;
        if (!(err instanceof ApiError)) throw err;
      }
      await d.runAsync('DELETE FROM queued_decisions WHERE owner = ? AND approval_id = ?', owner(), item.approvalId);
    }
  } finally {
    flushing = false;
  }
  if (sent) void queryClient.invalidateQueries();
  return sent;
}

/** Flush whenever connectivity comes back. */
export function startQueueSync(): () => void {
  void flushQueue();
  const sub = Network.addNetworkStateListener((state) => {
    if (state.isConnected) void flushQueue();
  });
  return () => sub.remove();
}
