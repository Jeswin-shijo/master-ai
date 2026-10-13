/**
 * Express "trust proxy" from TRUST_PROXY. Off by default, so a caller cannot
 * pick their own address with X-Forwarded-For. Behind a proxy or tunnel, set
 * it to the hop count (1), true, or the proxies' addresses ("loopback, 10.0.0.0/8").
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = value?.trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
