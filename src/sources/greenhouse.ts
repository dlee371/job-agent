// Greenhouse public Job Board API (no key needed).
// Docs: https://docs.greenhouse.io/job-board.html
import { z } from "zod";
import { htmlToText } from "@/lib/text";
import { canonicalApplyUrl } from "./detect-ats";
import { fetchJson } from "./http";
import type { CompanyBoard, JobListing } from "./types";

const GreenhouseJob = z.object({
  id: z.number(),
  title: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(), // HTML, entity-encoded
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  company_name: z.string().nullish(),
});

export function mapGreenhouseJob(raw: unknown, board: CompanyBoard): JobListing | null {
  const parsed = GreenhouseJob.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  const location = j.location?.name?.trim() || null;
  const remote = location ? /\bremote\b/i.test(location) : null;
  const jobId = String(j.id);
  return {
    source: "greenhouse",
    externalId: `${board.boardToken}:${jobId}`,
    title: j.title.trim(),
    company: j.company_name?.trim() || board.name,
    location,
    remote,
    workMode: remote ? "remote" : null, // Greenhouse doesn't say hybrid vs onsite
    description: j.content ? htmlToText(j.content) : null,
    // absolute_url often points at the company's own site; the canonical form is more reliable.
    applyUrl: canonicalApplyUrl("greenhouse", board.boardToken, jobId),
    ats: "greenhouse",
    atsBoardToken: board.boardToken,
    atsJobId: jobId,
    salaryMin: null,
    salaryMax: null,
    postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
  };
}

export async function fetchGreenhouseBoard(board: CompanyBoard): Promise<JobListing[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.boardToken)}/jobs?content=true`;
  const data = await fetchJson<{ jobs?: unknown[] }>(url, { label: `Greenhouse board "${board.boardToken}"`, timeoutMs: 60_000 });
  return (data.jobs ?? []).map((j) => mapGreenhouseJob(j, board)).filter((j): j is JobListing => j !== null);
}
