// Ashby public Job Posting API (no key needed).
// Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
import { z } from "zod";
import { canonicalApplyUrl } from "./detect-ats";
import { fetchJson } from "./http";
import type { CompanyBoard, JobListing, WorkMode } from "./types";

const AshbyJob = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string() })).nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(), // "Remote" | "Hybrid" | "OnSite"
  descriptionPlain: z.string().nullish(),
  publishedAt: z.string().nullish(),
});

const WORK_MODES: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

export function mapAshbyJob(raw: unknown, board: CompanyBoard): JobListing | null {
  const parsed = AshbyJob.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  if (j.isListed === false) return null; // unlisted jobs aren't meant to be public

  const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; ") || null;
  const workMode = WORK_MODES[(j.workplaceType ?? "").toLowerCase()] ?? null;

  return {
    source: "ashby",
    externalId: j.id,
    title: j.title.trim(),
    company: board.name,
    location,
    // Real data has isRemote: true on "Hybrid" jobs, so workplaceType wins when it's present.
    remote: workMode ? workMode === "remote" : (j.isRemote ?? null),
    workMode,
    description: j.descriptionPlain?.trim() || null,
    applyUrl: canonicalApplyUrl("ashby", board.boardToken, j.id),
    ats: "ashby",
    atsBoardToken: board.boardToken,
    atsJobId: j.id,
    salaryMin: null, // Ashby only gives a display string ("$120K – $150K"); not worth parsing yet
    salaryMax: null,
    postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
  };
}

export async function fetchAshbyBoard(board: CompanyBoard): Promise<JobListing[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.boardToken)}`;
  const data = await fetchJson<{ jobs?: unknown[] }>(url, { label: `Ashby board "${board.boardToken}"`, timeoutMs: 60_000 });
  return (data.jobs ?? []).map((j) => mapAshbyJob(j, board)).filter((j): j is JobListing => j !== null);
}
