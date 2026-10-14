import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  scrypt,
  timingSafeEqual,
  verify,
  type ScryptOptions,
} from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

/** scrypt runs on libuv's thread pool, so a login doesn't stall every other request. */
function scryptAsync(password: string, salt: Buffer, keyLen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return timingSafeEqual(expected, actual);
}

/** A stored hash that no password matches, checked when an email has no login. */
const NO_LOGIN = `scrypt$${SCRYPT.N}$${randomBytes(16).toString('base64')}$${randomBytes(SCRYPT.keyLen).toString('base64')}`;

/**
 * Whether a password matches a login's stored hash. An email with no login
 * (`stored` undefined) does the same work and fails, so the time a sign-in
 * takes doesn't reveal who has an account.
 */
export async function passwordMatches(password: string, stored: string | undefined): Promise<boolean> {
  const ok = await verifyPassword(password, stored ?? NO_LOGIN);
  return ok && stored !== undefined;
}

/** Verify an Ed25519 signature made by a device key (raw 32-byte public key, base64). */
export function verifyEd25519(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64');
    if (raw.length !== 32) return false;
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Minimal HS256 JWT. Swappable for Keycloak/OIDC verification later (see ADR 0004). */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyJwt<T extends Record<string, unknown>>(token: string, secret: string): T | null {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
