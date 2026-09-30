// `npm run tailor` — for each shortlisted job (best score first, up to today's cap):
//   1. create an application (status 'drafting')
//   2. Claude (MODEL_TAILORING) picks and rewrites your bullets, citing profile ids
//   3. code assembles the resume (companies/titles/dates copied from profile.json)
//   4. fact-check: code checks + a cheap Haiku check
//   5. render a one-page PDF to output/resumes/<application-id>/<Your_Name>_Resume.pdf
//   6. status -> ready_to_fill (Greenhouse/Lever/Ashby), manual_apply (other sites),
//      or needs_attention (fact-check found something, or it failed MAX_ATTEMPTS times)
//
//   npm run tailor                 up to DAILY_APPLICATION_CAP new applications today
//   npm run tailor -- --limit 3    at most 3 (good for a first look)
//   npm run tailor -- --retry-attention
//                                  re-tailor applications in needs_attention (fresh Claude output)
//
// Re-running is safe: jobs get at most one application (unique job_id), and only
// applications still in 'drafting' are (re)processed.
import path from "node:path";
import { chromium } from "playwright";
import { env } from "@/lib/env";
import { db, check, fetchAll } from "@/lib/db";
import { askStructured } from "@/lib/claude";
import { isFatalApiError } from "@/lib/claude-errors";
import { loadProfile } from "@/lib/profile";
import { errorMessage, finishRun, forEachItem, startRun, type RunStats } from "@/lib/run";
import { jobBlock, type PromptJob } from "@/prompts/job";
import { TAILOR_SYSTEM, tailorProfileBlock } from "@/prompts/tailor";
import { TailorResult, type FactCheckReport } from "@/schemas/tailor";
import { assembleResume } from "@/tailor/assemble";
import { deterministicChecks } from "@/factcheck/deterministic";
import { llmFactCheck } from "@/factcheck/llm";
import { renderResumePdf } from "@/resume/render";

const PREFILLABLE = ["greenhouse", "lever", "ashby"];

type Job = PromptJob & { id: string; ats: string; apply_url: string | null };
type Application = { id: string; attempts: number; job: Job };

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit"));
  const limit = limitArg ? Number(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1]) : null;
  if (limit !== null && !(limit > 0)) throw new Error("--limit needs a positive number, e.g. --limit 3");
  return { limit, retryAttention: args.includes("--retry-attention") };
}

/** Midnight today in your local time zone, as an ISO string. */
function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Creates applications for the best shortlisted jobs, respecting the daily cap. */
async function createApplications(limit: number | null): Promise<number> {
  const { count: today, error } = await db.from("applications").select("*", { count: "exact", head: true }).gte("created_at", startOfToday());
  if (error) throw new Error(`count today's applications failed: ${error.message}`);
  const remaining = Math.max(0, env.DAILY_APPLICATION_CAP - (today ?? 0));
  const wanted = Math.min(remaining, limit ?? remaining);
  console.log(`Daily cap: ${today}/${env.DAILY_APPLICATION_CAP} applications created today.`);
  if (wanted === 0) return 0;

  // Shortlisted jobs that don't have an application yet, best score first.
  const existing = new Set(
    (await fetchAll<{ job_id: string }>((f, t) => db.from("applications").select("job_id").order("id").range(f, t), "load applications")).map((a) => a.job_id),
  );
  const shortlisted = await fetchAll<{ id: string }>(
    (f, t) => db.from("jobs").select("id").eq("status", "shortlisted").order("fit_score", { ascending: false }).order("id").range(f, t),
    "load shortlisted jobs",
  );
  const picked = shortlisted.filter((j) => !existing.has(j.id)).slice(0, wanted);
  if (picked.length) {
    check(
      await db.from("applications").upsert(
        picked.map((j) => ({ job_id: j.id })),
        { onConflict: "job_id", ignoreDuplicates: true },
      ),
      "create applications",
    );
  }
  return picked.length;
}

async function loadDrafting(limit: number | null): Promise<Application[]> {
  const rows = check(
    await db
      .from("applications")
      .select("id, attempts, job:jobs(id, source, title, company, location, remote, work_mode, salary_min, salary_max, posted_at, description, ats, apply_url)")
      .eq("status", "drafting")
      .order("created_at")
      .limit(limit ?? 1000),
    "load drafting applications",
  );
  return (rows ?? []) as unknown as Application[];
}

async function recordFailure(app: Application, err: unknown) {
  const attempts = app.attempts + 1;
  const giveUp = attempts >= env.MAX_ATTEMPTS;
  check(
    await db
      .from("applications")
      .update({
        attempts,
        last_error: errorMessage(err),
        ...(giveUp ? { status: "needs_attention", attention_reason: `Tailoring failed ${attempts} times: ${errorMessage(err)}` } : {}),
      })
      .eq("id", app.id),
    "record failure",
  );
}

function summarizeIssues(report: FactCheckReport): string {
  const counts = new Map<string, number>();
  for (const i of report.issues) counts.set(i.check, (counts.get(i.check) ?? 0) + 1);
  return `Fact-check: ${[...counts].map(([check, n]) => `${n} × ${check}`).join(", ")}`;
}

async function main() {
  const { limit, retryAttention } = parseArgs();
  const profile = loadProfile();
  const profileBlock = tailorProfileBlock(profile);
  const runId = await startRun("tailor");
  let stats: RunStats = { processed: 0, succeeded: 0, failed: 0 };
  const browser = await chromium.launch(); // one browser for all PDFs

  try {
    if (retryAttention) {
      const reset = check(
        await db.from("applications").update({ status: "drafting", attempts: 0, attention_reason: null }).eq("status", "needs_attention").select("id"),
        "reset needs_attention",
      );
      console.log(`Sent ${reset?.length ?? 0} needs_attention applications back to drafting.`);
    }
    const created = await createApplications(limit);
    if (created) console.log(`Created ${created} new applications.`);
    const apps = await loadDrafting(limit);
    if (apps.length === 0) console.log("Nothing to tailor.");
    else console.log(`Tailoring ${apps.length} applications with ${env.MODEL_TAILORING}…`);

    const tailorOne = async (app: Application) => {
        const ids = { runId, jobId: app.job.id, applicationId: app.id };

        const tailored = await askStructured({
          purpose: "tailor",
          model: env.MODEL_TAILORING,
          system: TAILOR_SYSTEM,
          profileBlock,
          userBlock: jobBlock(app.job, new Date(), 12_000),
          schema: TailorResult,
          effort: "medium",
          ids,
        });

        const issues = [...deterministicChecks(profile, tailored, app.job.description), ...(await llmFactCheck(profile, tailored, ids))];
        const rendered = await renderResumePdf(assembleResume(profile, tailored), app.id, browser);
        if (!rendered.fitsOnePage) issues.push({ check: "too_long", detail: "Still longer than one page after trimming", bullet_text: null });

        const factcheck: FactCheckReport = { passed: issues.length === 0, issues };
        const changes = [
          ...tailored.changes,
          ...rendered.droppedBullets.map((b) => ({ what: `Removed "${b}"`, why: "to fit on one page" })),
        ];

        // Fact-check problems always come first: you need to see them before anything else.
        let status: "needs_attention" | "ready_to_fill" | "manual_apply";
        let extra: Record<string, string | null> = {};
        if (!factcheck.passed) {
          status = "needs_attention";
          extra = { attention_reason: summarizeIssues(factcheck) };
        } else if (PREFILLABLE.includes(app.job.ats)) {
          status = "ready_to_fill";
        } else {
          status = "manual_apply";
          extra = { manual_reason: app.job.apply_url ? "unsupported_ats" : "no_apply_url" };
        }

        check(
          await db
            .from("applications")
            .update({
              resume_json: rendered.resume,
              changes,
              gaps: tailored.gaps,
              factcheck,
              resume_pdf_path: path.relative(process.cwd(), rendered.pdfPath),
              status,
              last_error: null,
              ...extra,
            })
            .eq("id", app.id),
          "save application",
        );
        const mark = status === "needs_attention" ? "!" : "✓";
        console.log(`  ${mark} ${app.job.title} @ ${app.job.company} → ${status}${factcheck.passed ? "" : ` (${summarizeIssues(factcheck)})`}`);
    };
    const itemOpts = {
      label: (a: Application) => `${a.job.title} @ ${a.job.company}`,
      onError: recordFailure,
      isFatal: isFatalApiError,
    };
    // The first application runs alone so it writes the profile to the prompt cache; the rest
    // then run in parallel and READ it (0.1x the price) instead of each writing it (1.25x).
    const first = await forEachItem(apps.slice(0, 1), tailorOne, itemOpts);
    const rest = await forEachItem(apps.slice(1), tailorOne, { ...itemOpts, concurrency: Math.min(env.CLAUDE_CONCURRENCY, 3) });
    stats = {
      processed: first.processed + rest.processed,
      succeeded: first.succeeded + rest.succeeded,
      failed: first.failed + rest.failed,
    };

    await finishRun(runId, stats);
    const calls = check(await db.from("llm_calls").select("cost_usd").eq("run_id", runId), "load costs") ?? [];
    const cost = calls.reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);
    if (stats.processed) {
      console.log(`\n${stats.succeeded} tailored, ${stats.failed} failed. Cost: $${cost.toFixed(4)} ($${(cost / Math.max(1, stats.succeeded)).toFixed(4)} each).`);
      console.log("PDFs are in output/resumes/<application-id>/. Review them with: npm run report -- applications");
    }
  } catch (err) {
    await finishRun(runId, stats, err);
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (/usage limits|spend/i.test(String(err))) {
    console.error("Raise or remove your limit at https://platform.claude.com/settings/billing, then run this again.");
  }
  process.exit(1);
});
