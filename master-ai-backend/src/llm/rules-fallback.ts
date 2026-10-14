const MINUTE = 60_000;
const MAX_PAUSE = 6 * 60 * MINUTE;

/**
 * How long the built-in rules answer after the AI provider fails: until a
 * daily quota resets (at most six hours at a time), otherwise a minute.
 */
export function rulesPauseMs(err: unknown): number {
  const text = err instanceof Error ? err.message : String(err);
  if (!/PerDay/i.test(text)) return MINUTE;
  const delay = text.match(/retryDelay\\?"\s*:\s*\\?"(\d+(?:\.\d+)?)s/);
  return Math.min(delay ? Number(delay[1]) * 1000 : MAX_PAUSE, MAX_PAUSE);
}

/**
 * LLM_RULES_WHEN_UNAVAILABLE: when the provider is out of quota or can't be
 * reached, the built-in rules (each call's offline strategy) answer instead,
 * and keep answering for a while without calling it, so a demo on a free key
 * keeps working. Refusals and bad requests still surface.
 */
export class RulesFallback {
  private rulesUntil = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(provider: () => Promise<T>, rules: () => Promise<T>, retryable: (err: unknown) => boolean): Promise<{ value: T; fellBack: boolean }> {
    if (this.enabled && this.now() < this.rulesUntil) return { value: await rules(), fellBack: true };
    try {
      return { value: await provider(), fellBack: false };
    } catch (err) {
      if (!this.enabled || !retryable(err)) throw err;
      this.rulesUntil = this.now() + rulesPauseMs(err);
      return { value: await rules(), fellBack: true };
    }
  }

  /** When the provider is next tried, while the rules are answering. */
  get pausedUntil(): number | null {
    return this.rulesUntil > this.now() ? this.rulesUntil : null;
  }
}
