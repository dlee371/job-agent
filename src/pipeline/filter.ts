// `npm run filter` — free code filters on jobs with status 'new' (ARCHITECTURE.md §7):
//   new -> duplicate     (same job already kept from a better source)
//   new -> filtered_out  (filter_reason says why)
//   new -> to_score      (passed; Claude scores it in Phase 3)
// Only touches 'new' jobs, so re-running is safe.
//
//   npm run filter -- --recheck   also re-checks 'filtered_out' jobs (after you change a rule
//                                 or your preferences). Jobs already scored are never touched.
import pLimit from "p-limit";
import { env } from "@/lib/env";
import { db, check, fetchAll } from "@/lib/db";
import { loadPreferences } from "@/lib/profile";
import { startRun, finishRun } from "@/lib/run";
import { filterReason, type FilterableJob } from "@/filter/rules";
import { jobKeys, sourceRank, type DedupeJob } from "@/filter/dedupe";

type NewJob = DedupeJob & FilterableJob & { id: string; company: string };
type Decision = { id: string; status: "duplicate" | "filtered_out" | "to_score"; reason: string | null };

async function main() {
  const recheck = process.argv.includes("--recheck");
  const candidateStatuses = recheck ? ["new", "filtered_out"] : ["new"];
  const prefs = loadPreferences();
  const now = new Date();
  const runId = await startRun("filter");

  const newJobs = await fetchAll<NewJob>(
    (from, to) =>
      db
        .from("jobs")
        .select("id, source, company, title, location, remote, work_mode, description, posted_at, salary_min, salary_max, dedupe_key, ats, ats_board_token, ats_job_id, created_at")
        .in("status", candidateStatuses)
        .order("id")
        .range(from, to),
    "load jobs to filter",
  );
  if (newJobs.length === 0) {
    console.log(recheck ? "No new or filtered_out jobs." : "No new jobs. Run npm run search first.");
    await finishRun(runId, { processed: 0, succeeded: 0, failed: 0 });
    return;
  }

  // Keys of jobs we already processed. A new job matching one of them is a duplicate.
  const existing = await fetchAll<DedupeJob>(
    (from, to) =>
      db
        .from("jobs")
        .select("source, dedupe_key, ats, ats_board_token, ats_job_id")
        .not("status", "in", `(${[...candidateStatuses, "duplicate"].join(",")})`)
        .order("id")
        .range(from, to),
    "load existing jobs",
  );
  const claimed = new Set(existing.flatMap(jobKeys));

  // Best source first, so it wins over copies of the same job from worse sources.
  newJobs.sort((a, b) => sourceRank(a) - sourceRank(b) || String(a.created_at).localeCompare(String(b.created_at)));

  const decisions: Decision[] = newJobs.map((job) => {
    const keys = jobKeys(job);
    if (keys.some((k) => claimed.has(k))) return { id: job.id, status: "duplicate", reason: null };
    keys.forEach((k) => claimed.add(k));
    const reason = filterReason(job, prefs, { now, maxAgeDays: env.MAX_JOB_AGE_DAYS });
    return { id: job.id, status: reason ? "filtered_out" : "to_score", reason };
  });

  // Updates run 10 at a time; the local database handles that easily.
  const limit = pLimit(10);
  await Promise.all(
    decisions.map((d) =>
      limit(async () =>
        check(
          await db.from("jobs").update({ status: d.status, filter_reason: d.reason, updated_at: now.toISOString() }).eq("id", d.id).in("status", candidateStatuses),
          `update job ${d.id}`,
        ),
      ),
    ),
  );

  const count = (s: Decision["status"]) => decisions.filter((d) => d.status === s).length;
  await finishRun(runId, { processed: decisions.length, succeeded: decisions.length, failed: 0 });

  console.log(`Filtered ${decisions.length} ${recheck ? "new + previously filtered" : "new"} jobs:`);
  console.log(`  to_score      ${count("to_score")}`);
  console.log(`  filtered_out  ${count("filtered_out")}`);
  console.log(`  duplicate     ${count("duplicate")}`);

  // Group reasons by their type ("seniority: senior" -> "seniority") for a readable summary.
  const byType = new Map<string, number>();
  for (const d of decisions) if (d.reason) byType.set(d.reason.split(":")[0]!, (byType.get(d.reason.split(":")[0]!) ?? 0) + 1);
  if (byType.size) {
    console.log("\nWhy jobs were filtered out:");
    for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(12)} ${n}`);
  }

  const byId = new Map(newJobs.map((j) => [j.id, j]));
  const sample = decisions.filter((d) => d.status === "to_score").slice(0, 10);
  if (sample.length) {
    console.log("\nSample of jobs kept for scoring:");
    for (const d of sample) {
      const j = byId.get(d.id)!;
      console.log(`  - ${j.title} @ ${j.company} (${j.location ?? "?"}) [${j.source}${j.ats !== "other" && j.ats !== j.source ? `, ${j.ats} form` : ""}]`);
    }
  }
  console.log("\nCheck a few filtered_out rows in Studio (http://127.0.0.1:54323 → jobs, filter by status).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
