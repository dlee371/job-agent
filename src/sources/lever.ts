// Lever public Postings API (no key needed).
// Docs: https://github.com/lever/postings-api
import { z } from "zod";
import { htmlToText } from "@/lib/text";
import { canonicalApplyUrl } from "./detect-ats";
import { fetchJson } from "./http";
import type { CompanyBoard, JobListing, WorkMode } from "./types";

const LeverPosting = z.object({
  id: z.string(),
  text: z.string(),
  categories: z
    .object({ location: z.string().nullish(), allLocations: z.array(z.string()).nullish() })
    .nullish(),
  workplaceType: z.string().nullish(), // "remote" | "hybrid" | "on-site" | "unspecified"
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
  additionalPlain: z.string().nullish(),
  createdAt: z.number().nullish(), // milliseconds since epoch
  salaryRange: z
    .object({ min: z.number(), max: z.number(), interval: z.string(), currency: z.string() })
    .nullish(),
});

const WORK_MODES: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite" };

export function mapLeverPosting(raw: unknown, board: CompanyBoard): JobListing | null {
  const parsed = LeverPosting.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;

  const locations = p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location ?? ""];
  const location = locations.filter(Boolean).join("; ") || null;
  const workMode = WORK_MODES[p.workplaceType ?? ""] ?? null;

  // The description is split across several fields; join them so nothing (e.g. requirements) is lost.
  const description = [
    p.descriptionPlain,
    ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
    p.additionalPlain,
  ]
    .filter(Boolean)
    .join("\n\n");

  const yearlyUsd = p.salaryRange && p.salaryRange.interval === "per-year-salary" && p.salaryRange.currency === "USD";

  return {
    source: "lever",
    externalId: p.id,
    title: p.text.trim(),
    company: board.name,
    location,
    remote: workMode === "remote" || (location ? /\bremote\b/i.test(location) : null),
    workMode,
    description: description || null,
    applyUrl: canonicalApplyUrl("lever", board.boardToken, p.id),
    ats: "lever",
    atsBoardToken: board.boardToken,
    atsJobId: p.id,
    salaryMin: yearlyUsd ? p.salaryRange!.min : null,
    salaryMax: yearlyUsd ? p.salaryRange!.max : null,
    postedAt: p.createdAt ? new Date(p.createdAt) : null,
  };
}

export async function fetchLeverBoard(board: CompanyBoard): Promise<JobListing[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board.boardToken)}?mode=json`;
  const data = await fetchJson<unknown[]>(url, { label: `Lever board "${board.boardToken}"`, timeoutMs: 60_000 });
  return data.map((p) => mapLeverPosting(p, board)).filter((j): j is JobListing => j !== null);
}
