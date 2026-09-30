// USD per million tokens, from the Claude pricing docs (checked 2026-09-30).
// Update this table when prices or models change. Unknown models get cost = null
// (logged as a warning) rather than a wrong number.
type Price = { input: number; output: number };

const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute cache writes cost 1.25x input
const CACHE_READ_MULTIPLIER = 0.1; // cache reads cost 0.1x input
const BATCH_DISCOUNT = 0.5; // the Batches API is 50% off everything

/** Finds the price for a model id, including dated ids like "claude-haiku-4-5-20251001". */
export function priceFor(model: string): Price | null {
  // Longest match first, so a future "claude-sonnet-5" entry can't shadow "claude-sonnet-5-5".
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key]! : null;
}

export type TokenUsage = {
  inputTokens: number; // uncached input
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export function costUsd(model: string, usage: TokenUsage, isBatch = false): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const dollars =
    (usage.inputTokens * price.input +
      usage.cacheCreationTokens * price.input * CACHE_WRITE_MULTIPLIER +
      usage.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
      usage.outputTokens * price.output) /
    1_000_000;
  return isBatch ? dollars * BATCH_DISCOUNT : dollars;
}

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
// If a request is declined by a safety classifier, the API retries it on a fallback model
// instead of failing. Haiku 4.5 does not support it.
const SERVER_FALLBACK_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];

export function supportsServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.includes(model);
}
