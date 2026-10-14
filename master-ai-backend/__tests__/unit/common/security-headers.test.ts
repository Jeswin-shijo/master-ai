import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../../../src/common/security-headers';

function run(secure: boolean) {
  const headers: Record<string, string> = { 'X-Powered-By': 'Express' };
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    removeHeader: (k: string) => delete headers[k],
  };
  let nexted = false;
  securityHeaders({ secure } as never, res as never, () => (nexted = true));
  return { headers, nexted };
}

describe('securityHeaders', () => {
  it('answers with headers that stop browsers sniffing, framing or rendering API responses as pages', () => {
    const { headers, nexted } = run(false);
    expect(nexted).toBe(true);
    expect(headers).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });

  it("doesn't say what the server runs on", () => {
    expect(run(false).headers['X-Powered-By']).toBeUndefined();
  });

  it('tells browsers to keep using HTTPS, only when the request came over HTTPS', () => {
    expect(run(true).headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(run(false).headers['Strict-Transport-Security']).toBeUndefined();
  });
});
