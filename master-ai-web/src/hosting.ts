/**
 * How the built web app is served (Vercel's vercel.json, and `vite preview`
 * in CI so the browser tests run under the same rules): every path falls back
 * to index.html, hashed build files are cached for a year, and every page gets
 * security headers. The content security policy lets a page run only this
 * app's scripts and talk only to its API.
 */
export function hostingConfig(apiUrl: string) {
  const api = new URL(apiUrl);
  const socket = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Styles set from code (motion, the canvas, the brand colour) are inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api.origin} ${socket}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    rewrites: [{ source: '/(.*)', destination: '/index.html' }],
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // Invite and request-form links carry a key: keep them out of search results.
      { source: '/(invite|r)/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ],
  };
}

/** The headers every page gets, for `vite preview`. */
export function pageHeaders(apiUrl: string): Record<string, string> {
  return Object.fromEntries(hostingConfig(apiUrl).headers[0]!.headers.map((h) => [h.key, h.value]));
}
