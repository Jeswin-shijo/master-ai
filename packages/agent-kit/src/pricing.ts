/** USD per million tokens. Update when list prices change. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

/** Approximate Gemini list prices by family (USD per million tokens). A free Gemini key costs nothing. */
const GEMINI_PRICES: [RegExp, Price][] = [
  [/^gemini-.*flash-lite/, { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 }],
  [/^gemini-.*flash/, { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 }],
  [/^gemini-.*pro/, { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 0 }],
];

const FALLBACK_PRICE = PRICES['claude-opus-5-5']!;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? GEMINI_PRICES.find(([family]) => family.test(model))?.[1] ?? FALLBACK_PRICE;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
}
