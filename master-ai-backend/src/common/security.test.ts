import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Redactor } from '../llm/redaction';
import { hashPassword, signJwt, verifyEd25519, verifyJwt, verifyPassword } from './crypto';

describe('passwords', () => {
  it('hashes with a salt and verifies', () => {
    const a = hashPassword('correct horse battery');
    expect(a).not.toBe(hashPassword('correct horse battery'));
    expect(verifyPassword('correct horse battery', a)).toBe(true);
    expect(verifyPassword('wrong', a)).toBe(false);
  });
});

describe('session tokens', () => {
  const secret = 'x'.repeat(32);

  it('round-trips and rejects tampering', () => {
    const token = signJwt({ sub: 'p1', tid: 't1' }, secret, 60);
    expect(verifyJwt(token, secret)).toMatchObject({ sub: 'p1', tid: 't1' });
    const [h, b, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'p1', tid: 'other', exp: 9e9 })).toString('base64url');
    expect(verifyJwt(`${h}.${forged}.${s}`, secret)).toBeNull();
    expect(verifyJwt(`${h}.${b}.${s}`, 'y'.repeat(32))).toBeNull();
  });

  it('rejects expired tokens', () => {
    expect(verifyJwt(signJwt({ sub: 'p1' }, secret, -1), secret)).toBeNull();
  });
});

describe('device signatures', () => {
  it('verifies raw Ed25519 public keys', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
    const sig = sign(null, Buffer.from('hello'), privateKey).toString('base64');
    expect(verifyEd25519(raw, 'hello', sig)).toBe(true);
    expect(verifyEd25519(raw, 'hellO', sig)).toBe(false);
    expect(verifyEd25519('bm90IGEga2V5', 'hello', sig)).toBe(false);
  });
});

describe('PII redaction', () => {
  it('replaces PII with stable placeholders and restores it in tool arguments', () => {
    const r = new Redactor();
    const text = r.redact('Email asha@example.com or call +91 98765 43210. PAN ABCDE1234F. Again: asha@example.com');
    expect(text).toBe('Email [EMAIL_1] or call [PHONE_1]. PAN [PAN_1]. Again: [EMAIL_1]');
    expect(r.restore({ to: '[EMAIL_1]', cc: ['[PHONE_1]'] })).toEqual({ to: 'asha@example.com', cc: ['+91 98765 43210'] });
  });
});
