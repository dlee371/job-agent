// `npm run report` — quick terminal views, no Claude calls.
//
//   npm run report -- scores            the 25 most recently scored jobs
//   npm run report -- scores --all      every scored job
//   npm run report -- costs             Claude spend by step and model, and whether caching works
//   npm run report -- applications      tailored applications: PDF, changes, gaps, fact-check issues
import { db, fetchAll } from "@/lib/db";

const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function scores(all: boolean) {
  type Row = { fit_score: number; status: string; title: string; company: string; fit_reasons: string[] | null; missing_requirements: string[] | null };
  const rows = await fetchAll<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("fit_score, status, title, company, fit_reasons, missing_requirements")
        .not("fit_score", "is", null)
        .order("scored_at", { ascending: false })
        .range(from, to),
    "load scores",
  );
  const shown = all ? rows : rows.slice(0, 25);
  if (shown.length === 0) return console.log("No scored jobs yet. Run: npm run score -- --limit 10");

  for (const r of shown.sort((a, b) => b.fit_score - a.fit_score)) {
    const mark = r.status === "shortlisted" ? "✓" : " ";
    console.log(`\n${String(r.fit_score).padStart(3)} ${mark} ${r.title} @ ${r.company}`);
    for (const reason of (r.fit_reasons ?? []).slice(0, 3)) console.log(`       + ${cut(reason, 110)}`);
    for (const missing of (r.missing_requirements ?? []).slice(0, 2)) console.log(`       - missing: ${cut(missing, 100)}`);
  }
  const shortlisted = rows.filter((r) => r.status === "shortlisted").length;
  console.log(`\n${rows.length} scored: ${shortlisted} shortlisted (✓), ${rows.length - shortlisted} skipped.${all ? "" : " Add --all to see every one."}`);
}

async function costs() {
  type Row = {
    purpose: string;
    model: string;
    is_batch: boolean;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    cost_usd: number | null;
    job_id: string | null;
  };
  const rows = await fetchAll<Row>(
    (from, to) =>
      db.from("llm_calls").select("purpose, model, is_batch, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, job_id").order("id").range(from, to),
    "load llm_calls",
  );
  if (rows.length === 0) return console.log("No Claude calls logged yet.");

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.purpose} | ${r.model}${r.is_batch ? " (batch)" : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const table = [...groups].map(([key, rs]) => {
    const sum = (f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0);
    const input = sum((r) => r.input_tokens + r.cache_creation_tokens + r.cache_read_tokens);
    return {
      "step | model": key,
      calls: rs.length,
      "input tokens": input,
      "output tokens": sum((r) => r.output_tokens),
      "cached %": input ? `${Math.round((100 * sum((r) => r.cache_read_tokens)) / input)}%` : "-",
      "cost $": sum((r) => Number(r.cost_usd ?? 0)).toFixed(4),
      "$ per call": (sum((r) => Number(r.cost_usd ?? 0)) / rs.length).toFixed(5),
    };
  });
  console.table(table);
  const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  console.log(`Total: $${total.toFixed(4)} over ${rows.length} calls.`);
  console.log("cached % = share of input tokens read from the prompt cache (billed at 10%).");
}

async function applications() {
  type Row = {
    status: string;
    resume_pdf_path: string | null;
    changes: { what: string; why: string }[] | null;
    gaps: string[] | null;
    factcheck: { passed: boolean; issues: { check: string; detail: string; bullet_text: string | null }[] } | null;
    attention_reason: string | null;
    manual_reason: string | null;
    last_error: string | null;
    job: { title: string; company: string; fit_score: number | null };
  };
  const { data, error } = await db
    .from("applications")
    .select("status, resume_pdf_path, changes, gaps, factcheck, attention_reason, manual_reason, last_error, job:jobs(title, company, fit_score)")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return console.log("No applications yet. Run: npm run tailor -- --limit 3");

  for (const r of rows) {
    console.log(`\n[${r.status}] ${r.job.title} @ ${r.job.company} (fit ${r.job.fit_score ?? "?"})`);
    if (r.resume_pdf_path) console.log(`  PDF: ${r.resume_pdf_path}`);
    for (const c of (r.changes ?? []).slice(0, 4)) console.log(`  ~ ${cut(c.what, 70)} — ${cut(c.why, 60)}`);
    for (const g of (r.gaps ?? []).slice(0, 3)) console.log(`  gap: ${cut(g, 100)}`);
    for (const i of r.factcheck?.issues ?? []) {
      console.log(`  ! ${i.check}: ${cut(i.detail, 90)}`);
      if (i.bullet_text) console.log(`      "${cut(i.bullet_text, 100)}"`);
    }
    if (r.manual_reason) console.log(`  manual apply: ${r.manual_reason}`);
    if (r.last_error) console.log(`  last error: ${cut(r.last_error, 100)}`);
  }
}

async function main() {
  const [view = "scores", ...rest] = process.argv.slice(2);
  if (view === "scores") await scores(rest.includes("--all"));
  else if (view === "costs") await costs();
  else if (view === "applications") await applications();
  else {
    console.error(`Unknown report "${view}". Use: scores | costs | applications`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
