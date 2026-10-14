import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { approvalSigningMessage } from '@onehuman/schemas';
import { createDeviceKey, fromBase64, signApproval, toBase64, verifyApproval } from '../src/signing';

const seed = new Uint8Array(32).map((_, i) => i * 7);
const input = {
  approvalId: '7f8d2c1e-9b3a-4c5d-8e6f-1a2b3c4d5e6f',
  decision: 'approved' as const,
  editedArgs: null,
  notes: 'ok',
  signedAt: '2026-10-12T10:00:00.000Z',
};

describe('approval signing', () => {
  it('round-trips base64', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 64]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37) % 256);
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('signs and verifies with tweetnacl', () => {
    const key = createDeviceKey(seed);
    const sig = signApproval(key.seed, input);
    expect(verifyApproval(key.publicKey, input, sig)).toBe(true);
    expect(verifyApproval(key.publicKey, { ...input, decision: 'rejected' }, sig)).toBe(false);
  });

  it('produces signatures the backend verifies with node:crypto', () => {
    const key = createDeviceKey(seed);
    const sig = signApproval(key.seed, input);
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key.publicKey, 'base64')]);
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    expect(verify(null, Buffer.from(approvalSigningMessage(input)), publicKey, Buffer.from(sig, 'base64'))).toBe(true);
  });
});
