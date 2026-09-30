// `npm run score` — Claude (MODEL_SCORING) scores each 'to_score' job 0-100.
//   score >= FIT_SCORE_THRESHOLD and no deal breaker -> shortlisted, otherwise -> skipped
//
//   npm run score                    batch if >= BATCH_MIN_JOBS jobs are waiting, else direct
//   npm run score -- --limit 10      only score 10 jobs (great for sanity-checking the prompt)
//   npm run score -- --direct        never use a batch (faster, 2x the price)
//   npm run score -- --batch         always use a batch (50% cheaper, results within ~1 hour)
//   npm run score -- --wait          after submitting a batch, wait for it and collect results
//   npm run score -- --retry-failed  give score_failed jobs another try
//   npm run score -- --rescore       score shortlisted/skipped jobs again (after changing the
//                                    prompt or threshold). Jobs with an application are kept.
//
// Resumable: every run first collects any batch that was submitted earlier, so you can
// Ctrl-C while waiting and simply run it again later.
import { env } from "@/lib/env";
import { db, check, fetchAll } from "@/lib/db";
import { anthropic, askStructured, batchRequest, logLlmCall, parseBatchMessage } from "@/lib/claude";
import { isFatalApiError } from "@/lib/claude-errors";
import { loadPreferences, loadProfile } from "@/lib/profile";
import { errorMessage, finishRun, forEachItem, startRun, type RunStats } from "@/lib/run";
import { SCORE_SYSTEM, scoringJobBlock, scoringProfileBlock, type ScorableJob } from "@/prompts/score";
import { ScoreResult } from "@/schemas/score";
import { scoreToUpdate } from "@/scoring/apply";

type JobRow = ScorableJob & { id: string; attempts: number };
const JOB_COLUMNS = "id, source, title, company, location, remote, work_mode, salary_min, salary_max, posted_at, description, attempts";
const MAX_TOKENS = 2000; // a score + 5 short reasons fits easily
const POLL_SECONDS = 60;

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit"));
  const limit = limitArg ? Number(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1]) : null;
  if (limit !== null && !(limit > 0)) throw new Error("--limit needs a positive number, e.g. --limit 10");
  return {
    limit,
    forceBatch: args.includes("--batch"),
    forceDirect: args.includes("--direct"),
    wait: args.includes("--wait"),
    retryFailed: args.includes("--retry-failed"),
    rescore: args.includes("--rescore"),
  };
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/** Records a failed attempt; after MAX_ATTEMPTS the job becomes score_failed and stops being retried. */
async function recordFailure(job: { id: string; attempts: number }, err: unknown) {
  const attempts = job.attempts + 1;
  const status = attempts >= env.MAX_ATTEMPTS ? "score_failed" : "to_score";
  check(
    await db
      .from("jobs")
      .update({ status, attempts, last_error: errorMessage(err), score_batch_id: null, updated_at: new Date().toISOString() })
      .eq("id", job.id),
    "record failure",
  );
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

async function collectBatches(wait: boolean, runId: string): Promise<RunStats> {
  const stats: RunStats = { processed: 0, succeeded: 0, failed: 0 };
  const open = check(await db.from("llm_batches").select("id").eq("purpose", "score").neq("status", "collected"), "load batches") ?? [];

  for (const { id } of open) {
    let batch = await anthropic.messages.batches.retrieve(id);
    while (batch.processing_status !== "ended") {
      const c = batch.request_counts;
      console.log(`Batch ${id}: ${batch.processing_status} (${c.succeeded} done, ${c.processing} processing)`);
      if (!wait) {
        console.log("  Not finished yet. Run `npm run score` again later, or add --wait.");
        break;
      }
      await sleep(POLL_SECONDS);
      batch = await anthropic.messages.batches.retrieve(id);
    }
    if (batch.processing_status !== "ended") continue;

    console.log(`Collecting batch ${id}…`);
    const jobs = check(await db.from("jobs").select("id, attempts").eq("score_batch_id", id).eq("status", "scoring"), "load batch jobs") ?? [];
    const byId = new Map(jobs.map((j) => [j.id as string, j as { id: string; attempts: number }]));

    // Results arrive in any order, so we match them by custom_id (= job id).
    for await (const r of await anthropic.messages.batches.results(id)) {
      const job = byId.get(r.custom_id);
      if (!job) continue; // already handled (e.g. a previous partial collection)
      byId.delete(r.custom_id);
      stats.processed++;
      try {
        if (r.result.type !== "succeeded") throw new Error(`batch request ${r.result.type}`);
        const message = r.result.message;
        await logLlmCall({
          purpose: "score",
          model: message.model,
          usage: message.usage,
          stopReason: message.stop_reason,
          ids: { runId, jobId: job.id },
          isBatch: true,
        });
        const result = parseBatchMessage(message, ScoreResult);
        check(await db.from("jobs").update(scoreToUpdate(result, env.FIT_SCORE_THRESHOLD)).eq("id", job.id), "save score");
        stats.succeeded++;
      } catch (err) {
        stats.failed++;
        console.error(`  ✗ job ${job.id}: ${errorMessage(err)}`);
        await recordFailure(job, err);
      }
    }
    // Any job without a result goes back in the queue.
    for (const job of byId.values()) await recordFailure(job, new Error("no result in batch"));
    check(await db.from("llm_batches").update({ status: "collected", collected_at: new Date().toISOString() }).eq("id", id), "close batch");
  }
  return stats;
}

async function submitBatch(jobs: JobRow[], profileBlock: string): Promise<string> {
  const requests = jobs.map((job) =>
    batchRequest({
      customId: job.id,
      model: env.MODEL_SCORING,
      system: SCORE_SYSTEM,
      profileBlock,
      userBlock: scoringJobBlock(job),
      schema: ScoreResult,
      maxTokens: MAX_TOKENS,
    }),
  );
  const batch = await anthropic.messages.batches.create({ requests });
  // Record the batch immediately, so a crash after this point can't lead to paying twice.
  check(
    await db.from("llm_batches").insert({ id: batch.id, purpose: "score", status: "in_progress", request_count: requests.length }),
    "save batch",
  );
  for (let i = 0; i < jobs.length; i += 200) {
    const ids = jobs.slice(i, i + 200).map((j) => j.id);
    check(await db.from("jobs").update({ status: "scoring", score_batch_id: batch.id }).in("id", ids), "mark jobs scoring");
  }
  return batch.id;
}

// ---------------------------------------------------------------------------
// Direct
// ---------------------------------------------------------------------------

async function scoreDirect(jobs: JobRow[], profileBlock: string, runId: string): Promise<RunStats> {
  return forEachItem(
    jobs,
    async (job) => {
      const result = await askStructured({
        purpose: "score",
        model: env.MODEL_SCORING,
        system: SCORE_SYSTEM,
        profileBlock,
        userBlock: scoringJobBlock(job),
        schema: ScoreResult,
        maxTokens: MAX_TOKENS,
        ids: { runId, jobId: job.id },
      });
      const update = scoreToUpdate(result, env.FIT_SCORE_THRESHOLD);
      check(await db.from("jobs").update(update).eq("id", job.id), "save score");
      console.log(`  ${String(result.fit_score).padStart(3)}  ${update.status === "shortlisted" ? "✓" : " "}  ${job.title} @ ${job.company}`);
    },
    {
      label: (j) => `${j.title} @ ${j.company}`,
      concurrency: env.CLAUDE_CONCURRENCY,
      onError: recordFailure,
      isFatal: isFatalApiError,
    },
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const profileBlock = scoringProfileBlock(loadProfile(), loadPreferences());
  const runId = await startRun("score");
  const totals: RunStats = { processed: 0, succeeded: 0, failed: 0 };
  const add = (s: RunStats) => ((totals.processed += s.processed), (totals.succeeded += s.succeeded), (totals.failed += s.failed));

  try {
    // 1. Finish anything a previous run started.
    add(await collectBatches(opts.wait, runId));

    // 2. Pick up jobs waiting to be scored.
    if (opts.retryFailed) {
      check(await db.from("jobs").update({ status: "to_score", attempts: 0 }).eq("status", "score_failed"), "retry failed");
    }
    if (opts.rescore) {
      const withApplication = new Set(
        (await fetchAll<{ job_id: string }>((f, t) => db.from("applications").select("job_id").order("id").range(f, t), "load applications")).map(
          (a) => a.job_id,
        ),
      );
      const scored = await fetchAll<{ id: string }>(
        (f, t) => db.from("jobs").select("id").in("status", ["shortlisted", "skipped"]).order("id").range(f, t),
        "load scored jobs",
      );
      const ids = scored.map((j) => j.id).filter((id) => !withApplication.has(id));
      for (let i = 0; i < ids.length; i += 200) {
        check(await db.from("jobs").update({ status: "to_score", attempts: 0 }).in("id", ids.slice(i, i + 200)), "reset scores");
      }
      console.log(`Re-queued ${ids.length} scored jobs.`);
    }
    const all = await fetchAll<JobRow>(
      (from, to) => db.from("jobs").select(JOB_COLUMNS).eq("status", "to_score").order("created_at").range(from, to),
      "load jobs",
    );
    const jobs = opts.limit ? all.slice(0, opts.limit) : all;

    if (jobs.length === 0) {
      console.log("No jobs waiting to be scored.");
    } else {
      const useBatch = opts.forceBatch || (!opts.forceDirect && jobs.length >= env.BATCH_MIN_JOBS);
      if (useBatch) {
        const id = await submitBatch(jobs, profileBlock);
        console.log(`Submitted batch ${id} with ${jobs.length} jobs (50% cheaper; usually done within an hour).`);
        if (opts.wait) add(await collectBatches(true, runId));
        else console.log("Run `npm run score` again later to collect the results (or add --wait next time).");
      } else {
        console.log(`Scoring ${jobs.length} jobs directly with ${env.MODEL_SCORING}…  (score, ✓ = shortlisted)`);
        add(await scoreDirect(jobs, profileBlock, runId));
      }
    }

    await finishRun(runId, totals);
    await printSummary(runId, totals);
  } catch (err) {
    await finishRun(runId, totals, err);
    throw err;
  }
}

async function printSummary(runId: string, totals: RunStats) {
  if (totals.processed === 0) return;
  const calls = check(await db.from("llm_calls").select("cost_usd, cache_read_tokens").eq("run_id", runId), "load costs") ?? [];
  const cost = calls.reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);
  const cached = calls.filter((c) => (c.cache_read_tokens ?? 0) > 0).length;
  console.log(`\n${totals.succeeded} scored, ${totals.failed} failed. Cost this run: $${cost.toFixed(4)} (${cached}/${calls.length} calls used the cache).`);
  console.log("See the results: npm run report -- scores");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (/usage limits|spend/i.test(String(err))) {
    console.error("Raise or remove your limit at https://platform.claude.com/settings/billing, then run this again.");
  }
  process.exit(1);
});
