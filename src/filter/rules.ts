// The cheap, free filters that run in code BEFORE Claude sees a job (ARCHITECTURE.md §7).
// Each rule returns a reason string when the job should be dropped, or null when it passes.
// All pure functions, so they're easy to test and tweak.
import type { Preferences } from "@/schemas/profile";
import { normalize, words } from "@/lib/text";

export type FilterableJob = {
  title: string;
  location: string | null;
  remote: boolean | null;
  work_mode: "remote" | "hybrid" | "onsite" | null;
  description: string | null;
  posted_at: string | Date | null;
  salary_min: number | null;
  salary_max: number | null;
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

// Level words don't count when matching titles: "Junior Software Engineer" should match
// "Software Engineer" and "Associate Software Engineer".
const LEVEL_WORDS = new Set(["junior", "jr", "entry", "level", "associate", "new", "grad", "graduate", "early", "career", "i", "1"]);

function coreWords(title: string): string[] {
  return words(title).filter((w) => !LEVEL_WORDS.has(w));
}

/** Allows small endings like plurals ("analysts") but not different words ("engineering"). */
function wordMatches(jobWord: string, targetWord: string): boolean {
  return jobWord === targetWord || (jobWord.startsWith(targetWord) && jobWord.length - targetWord.length <= 2);
}

export function titleMatches(jobTitle: string, targetTitles: string[]): boolean {
  const jobWords = words(jobTitle);
  return targetTitles.some((target) => {
    const core = coreWords(target);
    return core.length > 0 && core.every((c) => jobWords.some((w) => wordMatches(w, c)));
  });
}

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

const SENIOR_WORDS = [
  "senior", "sr", "staff", "principal", "lead", "manager", "director", "head", "vp",
  "architect", "chief", "intern", "internship",
];
const LEVEL_NUMBERS = ["ii", "iii", "iv", "2", "3", "4", "5"];

export function seniorityReason(jobTitle: string, targetTitles: string[]): string | null {
  const jobWords = words(jobTitle);
  // If one of your own target titles uses the word (e.g. "Lead Analyst"), it's allowed.
  const targetWords = new Set(targetTitles.flatMap(words));
  for (const w of SENIOR_WORDS) {
    if (jobWords.includes(w) && !targetWords.has(w)) return `seniority: ${w}`;
  }
  for (const n of LEVEL_NUMBERS) {
    if (jobWords.includes(n) && !targetWords.has(n)) return `seniority: level ${n.toUpperCase()}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Location and work mode
// ---------------------------------------------------------------------------

const NON_US =
  /\b(canada|uk|united kingdom|england|london|ireland|europe|emea|germany|france|spain|netherlands|poland|portugal|india|apac|asia|australia|singapore|japan|brazil|latam|mexico|argentina|colombia|philippines|israel)\b/;
const US = /\b(us|usa|united states|u s)\b/;
// Location fields that don't name a place. Treated as unknown, so Claude judges them from the description.
const NOT_A_PLACE = new Set(["", "n a", "na", "tbd", "hybrid", "in office", "onsite", "on site", "multiple locations", "various"]);

/** "Austin, TX" -> "austin"; entries mentioning "remote" turn on remote jobs. */
export function parseLocations(locations: string[]): { cities: string[]; allowRemote: boolean } {
  const cities: string[] = [];
  let allowRemote = false;
  for (const loc of locations) {
    if (/remote/i.test(loc)) allowRemote = true;
    else cities.push(normalize(loc.split(",")[0] ?? loc));
  }
  return { cities: cities.filter(Boolean), allowRemote };
}

export function locationReason(job: FilterableJob, prefs: Preferences): string | null {
  if (job.work_mode && !prefs.work_modes.includes(job.work_mode)) return `work mode: ${job.work_mode}`;

  const loc = normalize(job.location ?? "");
  const { cities, allowRemote } = parseLocations(prefs.locations);
  const isRemote = job.work_mode === "remote" || job.remote === true || /\bremote\b/.test(loc);

  if (isRemote && allowRemote && prefs.work_modes.includes("remote")) {
    if (NON_US.test(loc) && !US.test(loc)) return `location: remote outside US (${job.location})`;
    return null;
  }
  if (cities.some((city) => ` ${loc} `.includes(` ${city} `))) return null;
  if (NOT_A_PLACE.has(loc)) return null; // unknown place: let Claude judge it from the description
  return `location: ${job.location ?? "unknown"}`;
}

// ---------------------------------------------------------------------------
// Years of experience, age, salary, deal breakers
// ---------------------------------------------------------------------------

/**
 * Finds the years of experience a description REQUIRES, e.g. "3+ years of experience"
 * or "3-5 years". Lines that say preferred / nice to have / bonus are ignored.
 * Returns null if no requirement is found.
 */
export function requiredYears(description: string | null): number | null {
  if (!description) return null;
  let required: number | null = null;
  for (const line of description.split(/\n|(?<=[.;])\s/)) {
    if (/prefer|nice to have|bonus|a plus|is a plus/i.test(line)) continue;
    if (!/experience/i.test(line)) continue;
    for (const m of line.matchAll(/\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?\b/gi)) {
      const n = Number(m[1]);
      if (n > 0 && n <= 15) required = Math.max(required ?? 0, n);
    }
  }
  return required;
}

function ageInDays(postedAt: string | Date | null, now: Date): number | null {
  if (!postedAt) return null;
  const t = new Date(postedAt).getTime();
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / 86_400_000);
}

export function dealBreakerReason(job: FilterableJob, dealBreakers: string[]): string | null {
  // Literal phrase match only. Claude also sees your deal breakers during scoring and
  // catches the ones phrased differently.
  const text = ` ${normalize(`${job.title} ${job.description ?? ""}`)} `;
  for (const phrase of dealBreakers) {
    const p = normalize(phrase);
    if (p && text.includes(` ${p} `)) return `deal breaker: ${phrase}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// All rules, in order. The first reason found wins.
// ---------------------------------------------------------------------------

export function filterReason(job: FilterableJob, prefs: Preferences, opts: { now: Date; maxAgeDays: number }): string | null {
  if (!titleMatches(job.title, prefs.target_titles)) return "title: no target title match";

  const seniority = seniorityReason(job.title, prefs.target_titles);
  if (seniority) return seniority;

  const location = locationReason(job, prefs);
  if (location) return location;

  const age = ageInDays(job.posted_at, opts.now);
  if (age !== null && age > opts.maxAgeDays) return `age: posted ${age} days ago`;

  const years = requiredYears(job.description);
  if (years !== null && years > prefs.max_years_required) return `years: requires ${years}+`;

  if (prefs.min_salary_usd && job.salary_max && job.salary_max < prefs.min_salary_usd) {
    return `salary: max $${job.salary_max} < $${prefs.min_salary_usd}`;
  }

  return dealBreakerReason(job, prefs.deal_breakers);
}
