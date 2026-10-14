import type { NextFunction, Request, Response } from 'express';

/**
 * Headers on every API response. The API answers with JSON and TwiML only,
 * so browsers may not sniff, frame or render it; HSTS is sent once a request
 * has arrived over HTTPS (behind a proxy, with TRUST_PROXY set).
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
