import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createDeviceKey, signApproval } from '@onehuman/sdk';
import type { ApprovalDecisionKind } from '@onehuman/schemas';
import { api } from './api';
import { useSession } from './session';

/**
 * This phone's approval key. The Ed25519 seed is created from the OS secure
 * random source, kept in the keychain/keystore, and only used after Face ID /
 * fingerprint. The server stores only the public key and verifies every
 * signed decision against it.
 */
interface StoredKey {
  seed: string;
  keyId: string;
}

const storageKey = (principalId: string) => `onehuman.deviceKey.${principalId}`;

export async function getDeviceKey(): Promise<StoredKey | null> {
  const principalId = useSession.getState().user?.principalId;
  if (!principalId) return null;
  const raw = await SecureStore.getItemAsync(storageKey(principalId));
  return raw ? (JSON.parse(raw) as StoredKey) : null;
}

export async function ensureDeviceKey(): Promise<StoredKey> {
  const principalId = useSession.getState().user?.principalId;
  if (!principalId) throw new Error('Not signed in');
  const existing = await getDeviceKey();
  if (existing) return existing;

  const pair = createDeviceKey(await Crypto.getRandomBytesAsync(32));
  const registered = await api.auth.registerDeviceKey({
    publicKey: pair.publicKey,
    label: `${Device.modelName ?? 'Phone'} (${Platform.OS})`,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  const stored: StoredKey = { seed: pair.seed, keyId: registered.id };
  await SecureStore.setItemAsync(storageKey(principalId), JSON.stringify(stored), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  return stored;
}

/** Ask for Face ID / fingerprint (or the device passcode when no biometrics are set up). */
export async function confirmWithBiometrics(reason: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel' });
  if (result.success) return true;
  // A device with no biometrics and no passcode can't prompt at all; the
  // keychain-held signing key is then the only proof, as on the web.
  return result.error === 'not_enrolled' || result.error === 'not_available' || result.error === 'passcode_not_set';
}

export interface SignedDecision {
  approvalId: string;
  decision: ApprovalDecisionKind;
  notes?: string;
  signature: string;
  keyId: string;
  signedAt: string;
}

export async function signDecision(approvalId: string, decision: ApprovalDecisionKind, notes?: string): Promise<SignedDecision> {
  const key = await ensureDeviceKey();
  const signedAt = new Date().toISOString();
  const signature = signApproval(key.seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return { approvalId, decision, notes, signature, keyId: key.keyId, signedAt };
}
