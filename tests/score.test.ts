import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { scoringJobBlock, scoringProfileBlock, type ScorableJob } from "@/prompts/score";
import { scoreToUpdate } from "@/scoring/apply";
import { isFatalApiError, isSpendLimitError, FatalRunError } from "@/lib/claude-errors";
import { Preferences, Profile } from "@/schemas/profile";
import { ScoreResult } from "@/schemas/score";

const profile = Profile.parse(JSON.parse(fs.readFileSync("templates/profile.example.json", "utf8")));
const prefs = Preferences.parse(JSON.parse(fs.readFileSync("templates/preferences.example.json", "utf8")));

const job: ScorableJob = {
  source: "greenhouse",
  title: "Software Engineer",
  company: "Acme",
  location: "Austin, TX",
  remote: false,
  work_mode: "hybrid",
  salary_min: 90000,
  salary_max: 120000,
  posted_at: "2026-09-28T10:00:00Z",
  description: "Build things.",
};

describe("scoringProfileBlock", () => {
  it("is identical on every call, so prompt caching can work", () => {
    expect(scoringProfileBlock(profile, prefs)).toBe(scoringProfileBlock(profile, prefs));
  });
  it("leaves out contact details", () => {
    const block = scoringProfileBlock(profile, prefs);
    expect(block).not.toContain(profile.basics.email);
    expect(block).not.toContain(profile.basics.phone!);
    expect(block).toContain("Wrote PostgreSQL queries");
  });
});

describe("scoringJobBlock", () => {
  it("wraps the job in <job> tags with the key facts and today's date", () => {
    const block = scoringJobBlock(job, new Date("2026-09-30T12:00:00Z"));
    expect(block.startsWith("Today's date: 2026-09-30\n\n<job>")).toBe(true);
    expect(block).toContain("Location: Austin, TX (work mode: hybrid)");
    expect(block).toContain("Salary: $90000 – $120000 per year");
    expect(block).toContain("Posted: 2026-09-28");
  });
  it("truncates very long descriptions", () => {
    const block = scoringJobBlock({ ...job, description: "x".repeat(10_000) });
    expect(block).toContain("[…truncated]");
    expect(block.length).toBeLessThan(6500);
  });
  it("warns Claude when only an Adzuna snippet is available", () => {
    expect(scoringJobBlock({ ...job, source: "adzuna" })).toMatch(/only a short snippet/);
  });
});

describe("scoreToUpdate", () => {
  const result: ScoreResult = { fit_score: 75, reasons: ["Knows React"], missing_requirements: [], deal_breaker_hit: false, deal_breaker: null };
  it("shortlists at or above the threshold", () => {
    expect(scoreToUpdate(result, 70).status).toBe("shortlisted");
    expect(scoreToUpdate({ ...result, fit_score: 69 }, 70).status).toBe("skipped");
  });
  it("skips a high score with a deal breaker and records why", () => {
    const u = scoreToUpdate({ ...result, fit_score: 95, deal_breaker_hit: true, deal_breaker: "unpaid" }, 70);
    expect(u.status).toBe("skipped");
    expect(u.fit_reasons[0]).toBe("Deal breaker: unpaid");
  });
});

describe("fatal API errors", () => {
  it("recognizes both kinds of spend limit", () => {
    expect(isSpendLimitError(new Error("400 You have reached your specified API usage limits. You will regain access on 2026-11-01"))).toBe(true);
    const tierCap = Object.assign(new Error("429 rate_limit_error"), { error: { error: { details: { error_code: "enforced_spend_limit_reached" } } } });
    expect(isSpendLimitError(tierCap)).toBe(true);
  });
  it("does not treat a normal rate limit as fatal", () => {
    expect(isFatalApiError(Object.assign(new Error("429 rate limited"), { status: 429 }))).toBe(false);
  });
  it("treats a bad API key as fatal", () => {
    expect(isFatalApiError(Object.assign(new Error("401 invalid x-api-key"), { status: 401 }))).toBe(true);
  });
  it("FatalRunError is an Error", () => {
    expect(new FatalRunError("x")).toBeInstanceOf(Error);
  });
});
