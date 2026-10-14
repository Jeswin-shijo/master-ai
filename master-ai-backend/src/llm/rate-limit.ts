/**
 * Spaces model calls out to stay under a provider's requests-per-minute limit
 * (LLM_MAX_RPM; a free Gemini key allows 15 a minute per model). Each call
 * takes the next free slot, reserved before it waits, so calls made at the same
 * moment queue up instead of all going at once. The limit is per process: the
 * worker makes nearly all model calls. 0 means no limit.
 */
export function rateLimiter(
  rpm: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): () => Promise<void> {
  if (rpm <= 0) return async () => undefined;
  const gap = 60_000 / rpm;
  let next = -Infinity;
  return async () => {
    const slot = Math.max(now(), next);
    next = slot + gap;
    const wait = slot - now();
    if (wait > 0) await sleep(wait);
  };
}
