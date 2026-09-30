import { describe, expect, it } from "vitest";
import { costUsd, priceFor, supportsServerFallback } from "@/lib/pricing";

describe("priceFor", () => {
  it("matches dated model ids", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
  });
  it("matches exact ids", () => {
    expect(priceFor("claude-sonnet-5-5")).toEqual({ input: 2, output: 10 });
  });
  it("returns null for unknown models instead of guessing", () => {
    expect(priceFor("claude-unknown-9")).toBeNull();
  });
});

describe("costUsd", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 0, cacheReadTokens: 0 };

  it("adds input and output cost", () => {
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(12); // $2 + $10
  });
  it("halves the cost for batch requests", () => {
    expect(costUsd("claude-sonnet-5-5", usage, true)).toBeCloseTo(6);
  });
  it("prices cache writes at 1.25x and cache reads at 0.1x of input", () => {
    const cached = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000 };
    expect(costUsd("claude-haiku-4-5-20251001", cached)).toBeCloseTo(1.25 + 0.1);
  });
});

describe("supportsServerFallback", () => {
  it("is on for Sonnet 5.5 and off for Haiku", () => {
    expect(supportsServerFallback("claude-sonnet-5-5")).toBe(true);
    expect(supportsServerFallback("claude-haiku-4-5-20251001")).toBe(false);
  });
});
