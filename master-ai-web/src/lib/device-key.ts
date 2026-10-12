import { createDeviceKey, signApproval, type DeviceKeyPair } from '@onehuman/sdk';
import type { ApprovalDecisionKind } from '@onehuman/schemas';
import { api } from './api';
import { useSession } from './session';

/**
 * This browser's approval signing key. The seed stays in this browser's
 * storage; only the public key is registered with the server. On mobile the
 * seed lives in the secure enclave-backed store behind Face ID / fingerprint.
 */
interface StoredKey extends DeviceKeyPair {
  keyId: string;
  principalId: string;
}

const storageKey = (principalId: string) => `onehuman.deviceKey.${principalId}`;

function read(principalId: string): StoredKey | null {
  try {
    const raw = localStorage.getItem(storageKey(principalId));
    return raw ? (JSON.parse(raw) as StoredKey) : null;
  } catch {
    return null;
  }
}

let pending: Promise<StoredKey> | null = null;

export async function ensureDeviceKey(): Promise<StoredKey> {
  const principalId = useSession.getState().user?.principalId;
  if (!principalId) throw new Error('Not signed in');
  const existing = read(principalId);
  if (existing) return existing;

  pending ??= (async () => {
    const pair = createDeviceKey(crypto.getRandomValues(new Uint8Array(32)));
    const registered = await api.auth.registerDeviceKey({
      publicKey: pair.publicKey,
      label: `Browser · ${navigator.platform || 'web'}`,
      platform: 'web',
    });
    const stored: StoredKey = { ...pair, keyId: registered.id, principalId };
    try {
      localStorage.setItem(storageKey(principalId), JSON.stringify(stored));
    } catch {
      // Without storage the key lives for this tab only; a new one registers next time.
    }
    return stored;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function signDecision(input: {
  approvalId: string;
  decision: ApprovalDecisionKind;
  notes?: string;
  editedArgs?: Record<string, unknown>;
}) {
  const key = await ensureDeviceKey();
  const signedAt = new Date().toISOString();
  const signature = signApproval(key.seed, {
    approvalId: input.approvalId,
    decision: input.decision,
    editedArgs: input.editedArgs ?? null,
    notes: input.notes ?? null,
    signedAt,
  });
  return { signature, keyId: key.keyId, signedAt };
}
