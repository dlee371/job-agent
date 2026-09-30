import { describe, expect, it } from "vitest";
import {
  filterReason,
  locationReason,
  parseLocations,
  requiredYears,
  seniorityReason,
  titleMatches,
  type FilterableJob,
} from "@/filter/rules";
import { dedupeKey, jobKeys, sourceRank } from "@/filter/dedupe";
import { Preferences } from "@/schemas/profile";

const prefs = Preferences.parse({
  target_titles: ["Junior Software Engineer", "Full-Stack Developer", "Data Analyst"],
  interests: [],
  locations: ["Austin, TX", "Cedar Park, TX", "Remote (US)"],
  max_commute_miles: 30,
  work_modes: ["remote", "hybrid"],
  min_salary_usd: 60000,
  deal_breakers: ["unpaid", "commission only"],
  max_years_required: 2,
});

const job = (overrides: Partial<FilterableJob> = {}): FilterableJob => ({
  title: "Software Engineer",
  location: "Austin, TX",
  remote: false,
  work_mode: null,
  description: "Build things with TypeScript.",
  posted_at: new Date("2026-09-28"),
  salary_min: null,
  salary_max: null,
  ...overrides,
});
const opts = { now: new Date("2026-09-30"), maxAgeDays: 21 };

describe("titleMatches", () => {
  it.each([
    "Software Engineer",
    "Associate Software Engineer",
    "Software Engineer I",
    "Fullstack Developer",
    "Full Stack Developer (React)",
    "Data Analysts",
  ])("matches %s", (title) => expect(titleMatches(title, prefs.target_titles)).toBe(true));

  it.each(["Software Engineering Manager", "Product Designer", "Data Engineer", "Developer Advocate"])(
    "rejects %s",
    (title) => expect(titleMatches(title, prefs.target_titles)).toBe(false),
  );
});

describe("seniorityReason", () => {
  it.each([
    ["Senior Software Engineer", "seniority: senior"],
    ["Sr. Software Engineer", "seniority: sr"],
    ["Staff Software Engineer", "seniority: staff"],
    ["Software Engineer II", "seniority: level II"],
    ["Software Engineer 3", "seniority: level 3"],
    ["Software Engineer Intern", "seniority: intern"],
  ])("%s -> %s", (title, reason) => expect(seniorityReason(title, prefs.target_titles)).toBe(reason));

  it("passes entry-level titles", () => {
    expect(seniorityReason("Software Engineer I", prefs.target_titles)).toBeNull();
    expect(seniorityReason("Junior Data Analyst", prefs.target_titles)).toBeNull();
  });

  it("allows a word when one of your own target titles uses it", () => {
    expect(seniorityReason("Lead Data Analyst", ["Lead Data Analyst"])).toBeNull();
  });
});

describe("locationReason", () => {
  it("parses preference locations", () => {
    expect(parseLocations(prefs.locations)).toEqual({ cities: ["austin", "cedar park"], allowRemote: true });
  });
  it.each([
    job({ location: "Austin, Texas, United States" }),
    job({ location: "Cedar Park, TX" }),
    job({ location: "Seattle; Austin, TX" }),
    job({ location: "Remote - US", remote: true }),
    job({ location: "New York, NY", remote: true }), // remote jobs can list an HQ
    job({ location: null, remote: null }), // unknown: Claude decides
  ])("passes %j", (j) => expect(locationReason(j, prefs)).toBeNull());

  it("rejects other cities", () => {
    expect(locationReason(job({ location: "Denver, CO" }), prefs)).toBe("location: Denver, CO");
  });
  it("rejects remote jobs outside the US", () => {
    expect(locationReason(job({ location: "Remote - Canada", remote: true }), prefs)).toMatch(/remote outside US/);
  });
  it("rejects onsite jobs when work_modes excludes onsite", () => {
    expect(locationReason(job({ work_mode: "onsite" }), prefs)).toBe("work mode: onsite");
  });
  it("does not match a city name inside another word", () => {
    expect(locationReason(job({ location: "Austintown, OH" }), prefs)).toBe("location: Austintown, OH");
  });
});

describe("requiredYears", () => {
  it.each([
    ["Requirements:\n- 3+ years of professional experience", 3],
    ["You have 3-5 years of experience with React.", 3],
    ["1 year of experience or a CS degree", 1],
    ["Experience: 2 years minimum", 2],
  ])("%s -> %i", (text, years) => expect(requiredYears(text)).toBe(years));

  it("ignores preferred qualifications and unrelated numbers", () => {
    expect(requiredYears("5+ years of experience preferred")).toBeNull();
    expect(requiredYears("Founded 20 years ago. We value experience.")).toBeNull();
    expect(requiredYears("Great benefits and 401k")).toBeNull();
  });
});

describe("filterReason", () => {
  it("passes a good entry-level job", () => {
    expect(filterReason(job(), prefs, opts)).toBeNull();
  });
  it("applies rules in order and reports the first failure", () => {
    expect(filterReason(job({ title: "Senior Software Engineer", location: "Denver" }), prefs, opts)).toBe("seniority: senior");
  });
  it("drops old postings", () => {
    expect(filterReason(job({ posted_at: new Date("2026-08-01") }), prefs, opts)).toBe("age: posted 60 days ago");
  });
  it("drops jobs requiring too many years", () => {
    expect(filterReason(job({ description: "Requires 4+ years of experience." }), prefs, opts)).toBe("years: requires 4+");
  });
  it("drops jobs paying below your minimum", () => {
    expect(filterReason(job({ salary_max: 50000 }), prefs, opts)).toBe("salary: max $50000 < $60000");
  });
  it("drops deal breakers matched as whole phrases", () => {
    expect(filterReason(job({ description: "This is a commission-only role." }), prefs, opts)).toBe("deal breaker: commission only");
  });
});

describe("dedupe", () => {
  it("builds the same key for the same job from different sources", () => {
    expect(dedupeKey("Stripe, Inc.", "Software Engineer (Remote)", "Austin, TX, US", false)).toBe(
      dedupeKey("Stripe", "Software Engineer", "Austin, Texas", false),
    );
  });
  it("uses 'remote' as the location key for remote jobs", () => {
    expect(dedupeKey("Acme", "Data Analyst", "New York, NY", true)).toBe("acme|data analyst|remote");
  });
  it("adds an exact ATS key when the job has one", () => {
    expect(jobKeys({ source: "jsearch", dedupe_key: "k", ats: "greenhouse", ats_board_token: "Acme", ats_job_id: "1" })).toEqual([
      "k",
      "greenhouse:acme:1",
    ]);
  });
  it("ranks company boards above aggregators", () => {
    const base = { dedupe_key: "k", ats_board_token: null, ats_job_id: null };
    expect(sourceRank({ ...base, source: "greenhouse", ats: "greenhouse" })).toBeLessThan(
      sourceRank({ ...base, source: "jsearch", ats: "greenhouse" }),
    );
    expect(sourceRank({ ...base, source: "jsearch", ats: "other" })).toBeLessThan(sourceRank({ ...base, source: "adzuna", ats: "other" }));
  });
});

describe("placeholder locations", () => {
  it.each(["N/A", "Hybrid", "In-Office", "TBD"])("treats %s as unknown", (location) => {
    expect(locationReason(job({ location }), prefs)).toBeNull();
  });
});
