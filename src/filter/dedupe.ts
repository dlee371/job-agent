// The same job often arrives from several sources (JSearch, Adzuna and the company's own
// Greenhouse board). We keep ONE copy, so we only pay to score it once.
import { normalize } from "@/lib/text";

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|incorporated|technologies|labs|group)\b/g;

/** company|title|city, normalized so "Stripe, Inc." and "Stripe" match. */
export function dedupeKey(company: string, title: string, location: string | null, remote: boolean | null): string {
  const c = normalize(company).replace(COMPANY_SUFFIXES, "").replace(/\s+/g, " ").trim();
  const t = normalize(title.replace(/\(.*?\)/g, "")); // "Engineer (Remote)" -> "engineer"
  const l = remote ? "remote" : normalize((location ?? "").split(/[,;/]/)[0] ?? "");
  return `${c}|${t}|${l}`;
}

export type DedupeJob = {
  source: string;
  dedupe_key: string;
  ats: string;
  ats_board_token: string | null;
  ats_job_id: string | null;
  created_at?: string;
};

/** Every key that identifies this job. Two jobs sharing ANY key are the same job. */
export function jobKeys(job: DedupeJob): string[] {
  const keys = [job.dedupe_key];
  // Exact match on the ATS job id catches copies whose company names differ a lot.
  if (job.ats !== "other" && job.ats_board_token && job.ats_job_id) {
    keys.push(`${job.ats}:${job.ats_board_token.toLowerCase()}:${job.ats_job_id}`);
  }
  return keys;
}

/** Lower is better: the company's own board has the full description and a fillable form. */
export function sourceRank(job: DedupeJob): number {
  if (["greenhouse", "lever", "ashby"].includes(job.source)) return 0;
  if (job.source === "jsearch" && job.ats !== "other") return 1;
  if (job.source === "jsearch") return 2;
  return 3; // adzuna: snippet only
}
