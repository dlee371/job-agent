// Adzuna search API (free developer key).
// Limitation: Adzuna returns only a SNIPPET of each description and an Adzuna redirect link,
// so these jobs are usually 'other' ATS (you apply by hand) and score less reliably.
// It's still useful for finding jobs the other sources miss.
import { z } from "zod";
import { htmlToText } from "@/lib/text";
import { fetchJson } from "./http";
import type { SearchQuery } from "./jsearch";
import type { JobListing } from "./types";

const AdzunaJob = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  company: z.object({ display_name: z.string().nullish() }).nullish(),
  location: z.object({ display_name: z.string().nullish() }).nullish(),
  description: z.string().nullish(),
  redirect_url: z.string().nullish(),
  created: z.string().nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_is_predicted: z.union([z.string(), z.number()]).nullish(), // "1" = Adzuna's estimate, not the employer's
});

export function mapAdzunaJob(raw: unknown): JobListing | null {
  const parsed = AdzunaJob.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  const location = j.location?.display_name?.trim() || null;
  const realSalary = String(j.salary_is_predicted ?? "0") !== "1";

  return {
    source: "adzuna",
    externalId: j.id,
    title: htmlToText(j.title), // titles can contain <strong> highlight tags
    company: j.company?.display_name?.trim() || "Unknown company",
    location,
    remote: location ? /\bremote\b/i.test(location) || /\bremote\b/i.test(j.title) : null,
    workMode: null,
    description: j.description ? htmlToText(j.description) : null,
    applyUrl: j.redirect_url ?? null,
    ats: "other",
    atsBoardToken: null,
    atsJobId: null,
    salaryMin: realSalary ? (j.salary_min ?? null) : null,
    salaryMax: realSalary ? (j.salary_max ?? null) : null,
    postedAt: j.created ? new Date(j.created) : null,
  };
}

export async function searchAdzuna(
  query: SearchQuery,
  opts: { appId: string; appKey: string; country: string; maxAgeDays: number; radiusMiles: number | null },
): Promise<JobListing[]> {
  const params = new URLSearchParams({
    app_id: opts.appId,
    app_key: opts.appKey,
    results_per_page: "50",
    what: query.location ? query.title : `${query.title} remote`,
    max_days_old: String(opts.maxAgeDays),
    "content-type": "application/json",
  });
  if (query.location) {
    params.set("where", query.location);
    if (opts.radiusMiles) params.set("distance", String(Math.round(opts.radiusMiles * 1.609))); // Adzuna uses km
  }

  const url = `https://api.adzuna.com/v1/api/jobs/${opts.country}/search/1?${params}`;
  const data = await fetchJson<{ results?: unknown[] }>(url, { label: "Adzuna" });
  return (data.results ?? []).map(mapAdzunaJob).filter((j): j is JobListing => j !== null);
}
