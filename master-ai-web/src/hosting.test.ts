import { describe, expect, it } from 'vitest';
import { hostingConfig } from './hosting';

const config = hostingConfig('https://api.example.com');
const headersFor = (path: string) =>
  Object.fromEntries(config.headers.filter((h) => new RegExp(`^${h.source.replace('(.*)', '.*')}$`).test(path)).flatMap((h) => h.headers.map((x) => [x.key, x.value])));

describe('hostingConfig', () => {
  it('lets pages run only this app’s own scripts and talk only to its API', () => {
    const csp = headersFor('/cases/1')['Content-Security-Policy']!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://api.example.com wss://api.example.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("can't be framed, sniffed or leak the address it was opened from", () => {
    expect(headersFor('/approvals')).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    expect(headersFor('/approvals')['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('keeps invite and request-form links, which carry a key, out of search results', () => {
    expect(headersFor('/invite/t1/abc')['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(headersFor('/r/t1/key')['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(headersFor('/login')['X-Robots-Tag']).toBeUndefined();
  });

  it('caches the hashed build files for a year and serves every other path the app', () => {
    expect(headersFor('/assets/index-abc123.js')['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(headersFor('/cases/1')['Cache-Control']).toBeUndefined();
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('uses ws:// for an API on plain http (local runs)', () => {
    const csp = hostingConfig('http://localhost:3000').headers[0]!.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain("connect-src 'self' http://localhost:3000 ws://localhost:3000");
  });
});
