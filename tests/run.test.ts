// forEachItem must keep going after ordinary failures, but stop on fatal ones.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, check: (r: { data: unknown }) => r.data }));
const { forEachItem } = await import("@/lib/run");
const { FatalRunError } = await import("@/lib/claude-errors");

describe("forEachItem", () => {
  it("keeps going when one item fails", async () => {
    const onError = vi.fn(async () => {});
    const stats = await forEachItem(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom");
      },
      { label: String, onError },
    );
    expect(stats).toEqual({ processed: 3, succeeded: 2, failed: 1 });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stops starting new items after a fatal error and does not record it as the item's failure", async () => {
    const seen: number[] = [];
    const onError = vi.fn(async () => {});
    await expect(
      forEachItem(
        [1, 2, 3, 4],
        async (n) => {
          seen.push(n);
          if (n === 2) throw new Error("spend limit");
        },
        { label: String, onError, isFatal: (e) => (e as Error).message === "spend limit" },
      ),
    ).rejects.toBeInstanceOf(FatalRunError);
    expect(seen).toEqual([1, 2]);
    expect(onError).not.toHaveBeenCalled();
  });
});
