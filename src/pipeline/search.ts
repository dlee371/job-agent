// `npm run search` — finds jobs and saves them to the `jobs` table (status 'new').
//
//   npm run search                          all sources
//   npm run search -- --sources=greenhouse,lever
//   npm run search -- --dry-run             show the plan, call nothing
//
// Order: JSearch + Adzuna first (they also discover new Greenhouse/Lever/Ashby companies),
// then every active company board. Re-running never creates duplicates (upsert on
// source + external_id), and one failing query or board never stops the rest.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "@/lib/env";
import { db, check, fetchAll } from "@/lib/db";
import { DATA_DIR, loadPreferences } from "@/lib/profile";
import { startRun, finishRun, forEachItem, type RunStats } from "@/lib/run";
import { titleMatches } from "@/filter/rules";
import { dedupeKey } from "@/filter/dedupe";
import { SOURCE_NAMES, type CompanyBoard, type JobListing, type SourceName } from "@/sources/types";
import { searchJSearch } from "@/sources/jsearch";
import { buildQueries } from "@/sources/queries";
import { searchAdzuna } from "@/sources/adzuna";
import { fetchGreenhouseBoard } from "@/sources/greenhouse";
import { fetchLeverBoard } from "@/sources/lever";
import { fetchAshbyBoard } from "@/sources/ashby";
import { HttpError } from "@/sources/http";

const BOARD_FETCHERS = { greenhouse: fetchGreenhouseBoard, lever: fetchLeverBoard, ashby: fetchAshbyBoard };

// data/companies.json (optional): companies you want polled. Template: templates/companies.example.json
const CompaniesFile = z.array(
  z.object({ name: z.string(), ats: z.enum(["greenhouse", "lever", "ashby"]), board_token: z.string() }),
);

function parseArgs() {
  const args = process.argv.slice(2);
  const sourcesArg = args.find((a) => a.startsWith("--sources="))?.split("=")[1];
  const sources = sourcesArg ? (sourcesArg.split(",") as SourceName[]) : SOURCE_NAMES;
  const unknown = sources.filter((s) => !SOURCE_NAMES.includes(s));
  if (unknown.length) throw new Error(`Unknown source(s): ${unknown.join(", ")}. Use: ${SOURCE_NAMES.join(", ")}`);
  return { sources, dryRun: args.includes("--dry-run") };
}

function toRow(j: JobListing) {
  return {
    source: j.source,
    external_id: j.externalId,
    dedupe_key: dedupeKey(j.company, j.title, j.location, j.remote),
    title: j.title,
    company: j.company,
    location: j.location,
    remote: j.remote,
    work_mode: j.workMode,
    description: j.description,
    apply_url: j.applyUrl,
    ats: j.ats,
    ats_board_token: j.atsBoardToken,
    ats_job_id: j.atsJobId,
    salary_min: j.salaryMin === null ? null : Math.round(j.salaryMin),
    salary_max: j.salaryMax === null ? null : Math.round(j.salaryMax),
    posted_at: j.postedAt && !Number.isNaN(j.postedAt.getTime()) ? j.postedAt.toISOString() : null,
    updated_at: new Date().toISOString(),
    // `status` is deliberately NOT included: on conflict, the existing status is kept.
  };
}

async function seedCompanies(): Promise<number> {
  const file = path.join(DATA_DIR, "companies.json");
  if (!fs.existsSync(file)) return 0;
  const companies = CompaniesFile.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  await upsertCompanies(companies.map((c) => ({ name: c.name, ats: c.ats, boardToken: c.board_token })), "manual");
  return companies.length;
}

async function upsertCompanies(boards: CompanyBoard[], origin: "manual" | "discovered") {
  if (boards.length === 0) return;
  const unique = new Map(boards.map((b) => [`${b.ats}:${b.boardToken}`, b]));
  const rows = [...unique.values()].map((b) => ({ name: b.name, ats: b.ats, board_token: b.boardToken, origin }));
  // ignoreDuplicates: a company you added by hand is never overwritten by discovery.
  check(await db.from("companies").upsert(rows, { onConflict: "ats,board_token", ignoreDuplicates: true }), "save companies");
}

async function upsertJobs(listings: JobListing[]) {
  // The same job can come back from several queries; Postgres rejects duplicates within one upsert.
  const unique = new Map(listings.map((j) => [`${j.source}:${j.externalId}`, j]));
  const rows = [...unique.values()].map(toRow);
  for (let i = 0; i < rows.length; i += 200) {
    check(await db.from("jobs").upsert(rows.slice(i, i + 200), { onConflict: "source,external_id" }), "save jobs");
  }
  return rows.length;
}

async function countJobs(): Promise<number> {
  const { count, error } = await db.from("jobs").select("*", { count: "exact", head: true });
  if (error) throw new Error(`count jobs failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const { sources, dryRun } = parseArgs();
  const prefs = loadPreferences();
  const queries = buildQueries(prefs);
  const cap = env.SEARCH_MAX_REQUESTS_PER_SOURCE;
  const cappedQueries = queries.slice(0, cap);

  console.log(`Sources: ${sources.join(", ")}`);
  const usesQueries = sources.includes("jsearch") || sources.includes("adzuna");
  if (usesQueries) {
    console.log(`${queries.length} queries per source (${prefs.target_titles.length} titles × ${prefs.locations.length} locations)`);
    if (queries.length > cap) {
      console.log(`! Only the first ${cap} run per source (SEARCH_MAX_REQUESTS_PER_SOURCE). Fewer titles or locations = more coverage per request.`);
    }
  }
  if (dryRun) {
    if (usesQueries) for (const q of cappedQueries) console.log(`  - "${q.title}" ${q.location ? `in ${q.location}` : "(remote)"}`);
    return;
  }

  const runId = await startRun("search");
  const totals: RunStats = { processed: 0, succeeded: 0, failed: 0 };
  const add = (s: RunStats) => {
    totals.processed += s.processed;
    totals.succeeded += s.succeeded;
    totals.failed += s.failed;
  };
  const listings: JobListing[] = [];
  const perSource: Record<string, number> = {};
  const note = (source: string, n: number) => (perSource[source] = (perSource[source] ?? 0) + n);

  try {
    const before = await countJobs();
    const seeded = await seedCompanies();
    if (seeded) console.log(`Loaded ${seeded} companies from data/companies.json`);

    // 1. JSearch
    if (sources.includes("jsearch")) {
      if (!env.RAPIDAPI_KEY) console.log("- jsearch: skipped (RAPIDAPI_KEY is empty in .env)");
      else {
        const discovered: CompanyBoard[] = [];
        add(
          await forEachItem(
            cappedQueries,
            async (q) => {
              const r = await searchJSearch(q, { apiKey: env.RAPIDAPI_KEY!, maxAgeDays: env.MAX_JOB_AGE_DAYS });
              listings.push(...r.listings);
              discovered.push(...r.boards);
              note("jsearch", r.listings.length);
            },
            { label: (q) => `jsearch "${q.title}" ${q.location ?? "remote"}`, concurrency: 2 },
          ),
        );
        await upsertCompanies(discovered, "discovered");
      }
    }

    // 2. Adzuna
    if (sources.includes("adzuna")) {
      if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) console.log("- adzuna: skipped (ADZUNA_APP_ID / ADZUNA_APP_KEY empty in .env)");
      else {
        add(
          await forEachItem(
            cappedQueries,
            async (q) => {
              const found = await searchAdzuna(q, {
                appId: env.ADZUNA_APP_ID!,
                appKey: env.ADZUNA_APP_KEY!,
                country: env.ADZUNA_COUNTRY,
                maxAgeDays: env.MAX_JOB_AGE_DAYS,
                radiusMiles: prefs.max_commute_miles,
              });
              listings.push(...found);
              note("adzuna", found.length);
            },
            { label: (q) => `adzuna "${q.title}" ${q.location ?? "remote"}`, concurrency: 2 },
          ),
        );
      }
    }

    // 3. Company boards (including any just discovered above)
    const boardSources = sources.filter((s): s is keyof typeof BOARD_FETCHERS => s in BOARD_FETCHERS);
    if (boardSources.length) {
      const companies = await fetchAll<{ id: string; name: string; ats: keyof typeof BOARD_FETCHERS; board_token: string; origin: string }>(
        (from, to) =>
          db.from("companies").select("id, name, ats, board_token, origin").eq("active", true).in("ats", boardSources).order("id").range(from, to),
        "load companies",
      );
      if (companies.length === 0) {
        console.log("- boards: no companies yet. Add some: cp templates/companies.example.json data/companies.json");
      }
      add(
        await forEachItem(
          companies,
          async (c) => {
            try {
              const all = await BOARD_FETCHERS[c.ats]({ name: c.name, ats: c.ats, boardToken: c.board_token });
              // Big boards list hundreds of jobs; keep only titles you target so the DB stays small.
              const relevant = all.filter((j) => titleMatches(j.title, prefs.target_titles));
              listings.push(...relevant);
              note(c.ats, relevant.length);
              await db.from("companies").update({ last_fetched_at: new Date().toISOString(), last_error: null }).eq("id", c.id);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // A discovered token that 404s was probably a wrong guess: stop polling it.
              const deactivate = err instanceof HttpError && err.status === 404 && c.origin === "discovered";
              await db.from("companies").update({ last_error: message, ...(deactivate ? { active: false } : {}) }).eq("id", c.id);
              throw err;
            }
          },
          { label: (c) => `${c.ats} board "${c.board_token}"`, concurrency: 4 },
        ),
      );
    }

    const saved = await upsertJobs(listings);
    const after = await countJobs();
    await finishRun(runId, totals);

    console.log("\nFound (after title match for boards):");
    for (const [source, n] of Object.entries(perSource)) console.log(`  ${source.padEnd(11)} ${n}`);
    console.log(`\n✓ Saved ${saved} jobs: ${after - before} new, ${saved - (after - before)} already known.`);
    if (totals.failed) console.log(`! ${totals.failed} queries/boards failed (see ✗ lines above); the rest were saved.`);
    console.log("Next: npm run filter");
  } catch (err) {
    await finishRun(runId, totals, err);
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
