import type { Ats } from "./detect-ats";

export type SourceName = "jsearch" | "adzuna" | "greenhouse" | "lever" | "ashby";
export const SOURCE_NAMES: SourceName[] = ["greenhouse", "lever", "ashby", "jsearch", "adzuna"];

export type WorkMode = "remote" | "hybrid" | "onsite";

/** One job from any source, before it is saved to the `jobs` table. */
export type JobListing = {
  source: SourceName;
  externalId: string; // unique within the source
  title: string;
  company: string;
  location: string | null;
  remote: boolean | null;
  workMode: WorkMode | null;
  description: string | null; // plain text
  applyUrl: string | null;
  ats: Ats;
  atsBoardToken: string | null;
  atsJobId: string | null;
  salaryMin: number | null; // yearly USD, only when the source says it's yearly
  salaryMax: number | null;
  postedAt: Date | null;
};

/** A company whose ATS board we poll (the `companies` table). */
export type CompanyBoard = { name: string; ats: Exclude<Ats, "other">; boardToken: string };
