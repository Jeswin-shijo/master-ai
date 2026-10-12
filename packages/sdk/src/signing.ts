import nacl from 'tweetnacl';
import { approvalSigningMessage, type ApprovalSigningInput } from '@onehuman/schemas';

/**
 * Device keys sign approval decisions, so the audit log can prove which device
 * (and therefore which person) approved an action. The seed never leaves the
 * device: SecureStore on mobile (behind Face ID / fingerprint), browser storage
 * on web. The server stores only the public key.
 */

export interface DeviceKeyPair {
  /** 32-byte Ed25519 seed, base64. Keep secret. */
  seed: string;
  /** 32-byte Ed25519 public key, base64. Register with the API. */
  publicKey: string;
}

/** Create a key pair from 32 random bytes supplied by the platform's secure RNG. */
export function createDeviceKey(randomBytes32: Uint8Array): DeviceKeyPair {
  if (randomBytes32.length !== 32) throw new Error('Device key seed must be 32 bytes');
  const pair = nacl.sign.keyPair.fromSeed(randomBytes32);
  return { seed: toBase64(randomBytes32), publicKey: toBase64(pair.publicKey) };
}

export function signApproval(seedBase64: string, input: ApprovalSigningInput): string {
  const pair = nacl.sign.keyPair.fromSeed(fromBase64(seedBase64));
  const message = new TextEncoder().encode(approvalSigningMessage(input));
  return toBase64(nacl.sign.detached(message, pair.secretKey));
}

export function verifyApproval(publicKeyBase64: string, input: ApprovalSigningInput, signatureBase64: string): boolean {
  const message = new TextEncoder().encode(approvalSigningMessage(input));
  return nacl.sign.detached.verify(message, fromBase64(signatureBase64), fromBase64(publicKeyBase64));
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '=';
  }
  return out;
}

export function fromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (ALPHABET.indexOf(clean[i]!) << 18) |
      (ALPHABET.indexOf(clean[i + 1]!) << 12) |
      ((ALPHABET.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (ALPHABET.indexOf(clean[i + 3] ?? 'A') & 63);
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}
