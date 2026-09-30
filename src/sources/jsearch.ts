// JSearch on RapidAPI: aggregated listings from Google for Jobs (including jobs posted on
// LinkedIn/Indeed). We only READ its API results; we never open LinkedIn/Indeed pages.
// Each job has several apply links; we pick the employer's own ATS link when there is one.
import { z } from "zod";
import { canonicalApplyUrl, detectAts, isBlockedUrl, type AtsInfo } from "./detect-ats";
import { fetchJson } from "./http";
import type { CompanyBoard, JobListing } from "./types";

export type SearchQuery = { title: string; location: string | null }; // location null = remote

const JSearchJob = z.object({
  job_id: z.string(),
  job_title: z.string(),
  employer_name: z.string(),
  job_city: z.string().nullish(),
  job_state: z.string().nullish(),
  job_location: z.string().nullish(),
  job_is_remote: z.boolean().nullish(),
  job_description: z.string().nullish(),
  job_apply_link: z.string().nullish(),
  job_apply_is_direct: z.boolean().nullish(),
  apply_options: z
    .array(z.object({ publisher: z.string().nullish(), apply_link: z.string(), is_direct: z.boolean().nullish() }))
    .nullish(),
  job_posted_at_datetime_utc: z.string().nullish(),
  job_min_salary: z.number().nullish(),
  job_max_salary: z.number().nullish(),
  job_salary_period: z.string().nullish(),
});

type ApplyCandidate = { url: string; isDirect: boolean };

/**
 * Chooses the best apply link: a Greenhouse/Lever/Ashby link first (we can pre-fill those),
 * then a direct employer link, then anything else. LinkedIn/Indeed links are never chosen.
 */
export function pickApplyUrl(candidates: ApplyCandidate[]): { applyUrl: string | null } & AtsInfo {
  const allowed = candidates.filter((c) => c.url && !isBlockedUrl(c.url));
  for (const c of allowed) {
    const info = detectAts(c.url);
    if (info.ats !== "other") return { ...info, applyUrl: canonicalApplyUrl(info.ats, info.boardToken, info.jobId) };
  }
  const best = allowed.find((c) => c.isDirect) ?? allowed[0];
  return { ats: "other", boardToken: null, jobId: null, applyUrl: best?.url ?? null };
}

/** Maps one JSearch result. Also returns any ATS boards seen in its links (auto-discovery). */
export function mapJSearchJob(raw: unknown): { listing: JobListing; boards: CompanyBoard[] } | null {
  const parsed = JSearchJob.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;

  const candidates: ApplyCandidate[] = [
    ...(j.apply_options ?? []).map((o) => ({ url: o.apply_link, isDirect: o.is_direct ?? false })),
    ...(j.job_apply_link ? [{ url: j.job_apply_link, isDirect: j.job_apply_is_direct ?? false }] : []),
  ];
  const pick = pickApplyUrl(candidates);

  const boards: CompanyBoard[] = [];
  for (const c of candidates) {
    const info = detectAts(c.url);
    if (info.ats !== "other" && info.boardToken) boards.push({ name: j.employer_name, ats: info.ats, boardToken: info.boardToken });
  }

  const location = j.job_location || [j.job_city, j.job_state].filter(Boolean).join(", ") || null;
  const yearly = j.job_salary_period?.toUpperCase() === "YEAR";

  return {
    listing: {
      source: "jsearch",
      externalId: j.job_id,
      title: j.job_title.trim(),
      company: j.employer_name.trim(),
      location,
      remote: j.job_is_remote ?? null,
      workMode: j.job_is_remote ? "remote" : null,
      description: j.job_description?.trim() || null,
      applyUrl: pick.applyUrl,
      ats: pick.ats,
      atsBoardToken: pick.boardToken,
      atsJobId: pick.jobId,
      salaryMin: yearly ? (j.job_min_salary ?? null) : null,
      salaryMax: yearly ? (j.job_max_salary ?? null) : null,
      postedAt: j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc) : null,
    },
    boards,
  };
}

/** JSearch's date_posted only accepts a few values; pick the smallest one that covers maxAgeDays. */
function datePosted(maxAgeDays: number): string {
  if (maxAgeDays <= 1) return "today";
  if (maxAgeDays <= 3) return "3days";
  if (maxAgeDays <= 7) return "week";
  if (maxAgeDays <= 31) return "month";
  return "all";
}

export async function searchJSearch(
  query: SearchQuery,
  opts: { apiKey: string; maxAgeDays: number },
): Promise<{ listings: JobListing[]; boards: CompanyBoard[] }> {
  const params = new URLSearchParams({
    query: query.location ? `${query.title} in ${query.location}` : query.title,
    page: "1",
    num_pages: "1", // each extra page costs another request from the free quota
    country: "us",
    date_posted: datePosted(opts.maxAgeDays),
  });
  if (!query.location) params.set("work_from_home", "true");

  const data = await fetchJson<{ data?: unknown[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { "x-rapidapi-key": opts.apiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
    label: "JSearch",
  });

  const listings: JobListing[] = [];
  const boards: CompanyBoard[] = [];
  for (const raw of data.data ?? []) {
    const mapped = mapJSearchJob(raw);
    if (!mapped) continue;
    listings.push(mapped.listing);
    boards.push(...mapped.boards);
  }
  return { listings, boards };
}
