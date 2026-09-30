// Helpers every pipeline step uses:
// - startRun / finishRun record a row in `runs` so you can see what ran and how it went.
// - forEachItem processes items with limited concurrency and NEVER lets one failure stop the batch.
import pLimit from "p-limit";
import { db, check } from "./db";

export type RunStats = { processed: number; succeeded: number; failed: number };

export async function startRun(step: string): Promise<string> {
  const row = check(await db.from("runs").insert({ step }).select("id").single(), "startRun");
  if (!row) throw new Error("startRun: no row returned");
  return row.id as string;
}

export async function finishRun(runId: string, stats: RunStats, error?: unknown): Promise<void> {
  check(
    await db
      .from("runs")
      .update({ finished_at: new Date().toISOString(), stats, error: error ? errorMessage(error) : null })
      .eq("id", runId),
    "finishRun",
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs `work` on every item, at most `concurrency` at a time.
 * If `work` throws, the error is logged and passed to `onError` (e.g. to save `last_error`
 * and bump `attempts` on the row), and the loop moves on to the next item.
 */
export async function forEachItem<T>(
  items: T[],
  work: (item: T) => Promise<void>,
  opts: {
    label: (item: T) => string;
    concurrency?: number;
    onError?: (item: T, err: unknown) => Promise<void>;
  },
): Promise<RunStats> {
  const limit = pLimit(opts.concurrency ?? 1);
  const stats: RunStats = { processed: 0, succeeded: 0, failed: 0 };

  await Promise.all(
    items.map((item) =>
      limit(async () => {
        stats.processed++;
        try {
          await work(item);
          stats.succeeded++;
        } catch (err) {
          stats.failed++;
          console.error(`  ✗ ${opts.label(item)}: ${errorMessage(err)}`);
          if (opts.onError) {
            // A failure while recording the failure must not stop the batch either.
            await opts.onError(item, err).catch((e) => console.error(`    (could not record error: ${errorMessage(e)})`));
          }
        }
      }),
    ),
  );
  return stats;
}
